import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { removeBackground } from "../src/lib/background-removal";
import type { BackgroundProgress, BackgroundRequest, BackgroundResponse } from "../src/lib/background-removal-types";

type Listener = EventListenerOrEventListenerObject;

class FakeWorker {
  static instances: FakeWorker[] = [];
  static throwOnPost = false;
  listeners = new Map<string, Set<Listener>>();
  requests: BackgroundRequest[] = [];
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: Listener) { this.listeners.get(type)?.delete(listener); }
  postMessage(request: BackgroundRequest) {
    if (FakeWorker.throwOnPost) throw new Error("postMessage failed");
    this.requests.push(request);
  }
  terminate() { this.terminated = true; }
  get id() { return this.requests.at(-1)!.id; }
  get listenerCount() { return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0); }
  async dispatch(type: string, event: Event) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      if (typeof listener === "function") await listener.call(this, event);
      else await listener.handleEvent(event);
    }
  }
  async send(message: BackgroundResponse) { await this.dispatch("message", new MessageEvent("message", { data: message })); }
  async complete(id = this.id) { await this.send({ id, type: "complete", image: new Blob(["cutout"], { type: "image/webp" }) }); }
}

class FakeFileReader {
  static instances: FakeFileReader[] = [];
  static defer = false;
  static fail = false;
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeFileReader.instances.push(this); }
  readAsDataURL() { if (!FakeFileReader.defer) queueMicrotask(() => this.complete()); }
  complete() {
    if (FakeFileReader.fail) this.onerror?.();
    else { this.result = "data:image/webp;base64,Y3V0b3V0"; this.onload?.(); }
  }
}

const photo = () => new Blob(["photo"], { type: "image/png" });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function start(onProgress: (progress: BackgroundProgress) => void = () => {}, signal?: AbortSignal) {
  const result = removeBackground(photo(), onProgress, signal);
  void result.catch(() => {});
  return result;
}
function setup(context: TestContext) {
  const descriptors = new Map(["Worker", "OffscreenCanvas", "FileReader", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  FakeWorker.instances = [];
  FakeWorker.throwOnPost = false;
  FakeFileReader.instances = [];
  FakeFileReader.defer = false;
  FakeFileReader.fail = false;
  Object.defineProperties(globalThis, {
    Worker: { configurable: true, writable: true, value: FakeWorker },
    OffscreenCanvas: { configurable: true, writable: true, value: class {} },
    FileReader: { configurable: true, writable: true, value: FakeFileReader },
  });
  context.mock.timers.enable({ apis: ["setTimeout"] });
  context.after(async () => {
    context.mock.timers.tick(360_001);
    await flush();
    context.mock.timers.tick(60_001);
    context.mock.timers.reset();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
}

test("a pre-cancelled request never starts a worker or downloads a photo", async (context) => {
  setup(context);
  globalThis.fetch = async () => { throw new Error("Unexpected download"); };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(removeBackground("https://example.com/photo.png", () => {}, controller.signal), { name: "AbortError" });
  assert.equal(FakeWorker.instances.length, 0);
});

test("only the active job receives progress and results; a successful worker is reused then released", async (context) => {
  setup(context);
  const progress: BackgroundProgress[] = [];
  const first = start((value) => progress.push(value));
  const worker = FakeWorker.instances[0];
  const firstId = worker.id;
  await worker.send({ id: "stale", type: "progress", value: { stage: "processing" } });
  await worker.complete("stale");
  assert.deepEqual(progress, [{ stage: "download" }]);
  assert.equal(FakeFileReader.instances.length, 0);
  await worker.send({ id: firstId, type: "progress", value: { stage: "processing" } });
  await worker.complete();
  assert.equal(await first, "data:image/webp;base64,Y3V0b3V0");
  assert.equal(worker.listenerCount, 0);
  context.mock.timers.tick(59_000);
  const second = start();
  assert.equal(FakeWorker.instances.length, 1);
  assert.notEqual(worker.id, firstId);
  await worker.send({ id: firstId, type: "error", message: "Old failure" });
  context.mock.timers.tick(2_000);
  assert.equal(worker.terminated, false);
  await worker.complete();
  await second;
  context.mock.timers.tick(60_000);
  assert.equal(worker.terminated, true);
});

test("cancellation releases the worker, rejects concurrent work, and allows a fresh job", async (context) => {
  setup(context);
  const controller = new AbortController();
  const first = start(() => {}, controller.signal);
  const oldWorker = FakeWorker.instances[0];
  await assert.rejects(start(), /current photo/);
  controller.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(oldWorker.terminated, true);
  assert.equal(oldWorker.listenerCount, 0);
  const second = start();
  const newWorker = FakeWorker.instances[1];
  await oldWorker.complete();
  assert.equal(newWorker.terminated, false);
  await newWorker.complete();
  await second;
});

test("a late image conversion after cancellation cannot settle or terminate a newer job", async (context) => {
  setup(context);
  FakeFileReader.defer = true;
  const controller = new AbortController();
  const first = start(() => {}, controller.signal);
  const oldWorker = FakeWorker.instances[0];
  const oldCompletion = oldWorker.complete();
  const oldReader = FakeFileReader.instances[0];
  controller.abort();
  await assert.rejects(first, { name: "AbortError" });
  FakeFileReader.defer = false;
  const second = start();
  const newWorker = FakeWorker.instances[1];
  oldReader.complete();
  await oldCompletion;
  assert.equal(newWorker.terminated, false);
  assert.equal(newWorker.listenerCount, 2);
  await newWorker.complete();
  await second;
});

for (const failure of ["worker message", "worker crash", "image conversion"] as const) {
  test(`${failure} errors clean up and permit retry`, async (context) => {
    setup(context);
    const pending = start();
    const worker = FakeWorker.instances[0];
    if (failure === "worker message") await worker.send({ id: worker.id, type: "error", message: "Model unavailable" });
    else if (failure === "worker crash") await worker.dispatch("error", new Event("error"));
    else { FakeFileReader.fail = true; await worker.complete(); }
    await assert.rejects(pending, failure === "worker message" ? /Model unavailable/ : failure === "worker crash" ? /could not run/ : /could not be saved/);
    assert.equal(worker.terminated, true);
    assert.equal(worker.listenerCount, 0);
    FakeFileReader.fail = false;
    const retry = start();
    await FakeWorker.instances[1].complete();
    await retry;
  });
}

test("the processing deadline rejects and removes listeners before a new job starts", async (context) => {
  setup(context);
  const pending = start();
  const worker = FakeWorker.instances[0];
  context.mock.timers.tick(300_000);
  await assert.rejects(pending, /took too long/);
  assert.equal(worker.terminated, true);
  assert.equal(worker.listenerCount, 0);
  const retry = start();
  await FakeWorker.instances[1].complete();
  await retry;
});

for (const failure of ["postMessage", "initial progress", "later progress"] as const) {
  test(`${failure} exceptions clean up immediately and cannot terminate a later job`, async (context) => {
    setup(context);
    FakeWorker.throwOnPost = failure === "postMessage";
    let calls = 0;
    const pending = start(() => {
      calls++;
      if ((failure === "initial progress" && calls === 1) || (failure === "later progress" && calls === 2)) throw new Error("Progress callback failed");
    });
    const worker = FakeWorker.instances[0];
    if (failure === "later progress") await worker.send({ id: worker.id, type: "progress", value: { stage: "processing" } });
    await assert.rejects(pending);
    assert.equal(worker.listenerCount, 0);
    assert.equal(worker.terminated, true);
    FakeWorker.throwOnPost = false;
    const retry = start();
    const nextWorker = FakeWorker.instances[1];
    context.mock.timers.tick(299_999);
    assert.equal(nextWorker.terminated, false);
    await nextWorker.complete();
    await retry;
  });
}

test("invalid or unavailable photos fail before creating a worker", async (context) => {
  setup(context);
  await assert.rejects(removeBackground(new Blob([], { type: "image/png" }), () => {}), /20 MB/);
  await assert.rejects(removeBackground(new Blob(["svg"], { type: "image/svg+xml" }), () => {}), /JPG, PNG, WebP, or AVIF/);
  globalThis.fetch = async () => new Response(null, { status: 404 });
  await assert.rejects(removeBackground("https://example.com/photo.png", () => {}), /could not be opened/);
  assert.equal(FakeWorker.instances.length, 0);
});
