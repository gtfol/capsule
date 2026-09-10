import assert from "node:assert/strict";
import test from "node:test";
import { createShareHandlers, type ShareDependencies } from "../src/lib/server/share-api";
import { MAX_SHARE_BODY_BYTES, type ShareSnapshot } from "../src/lib/share-types";
import { ShareError } from "../src/lib/server/shares";

const id = Buffer.alloc(16, 1).toString("base64url"), token = Buffer.alloc(32, 2).toString("base64url");
const imageData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPuoAAAAASUVORK5CYII=";
const snapshot: ShareSnapshot = { version: 1, kind: "piece", title: "A piece", pieces: [{ name: "Shirt", brand: "", category: "tops", size: "M", color: "White", price: "20", currency: "USD", description: "", purchaseUrl: "https://shop.example/shirt", imageData }] };
const origin = "https://capsule.example";
const request = (method: string, body?: unknown, headers: Record<string, string> = {}) => new Request(`${origin}/api/share/${id}`, {
  method, headers: { origin, "content-type": "application/json", "x-share-token": token, ...headers },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
function setup() {
  const calls: { method: string; args: unknown[] }[] = [];
  const metadata = { id, expiry: "7d" as const, expiresAt: 1_900_000_000_000, updatedAt: 1_800_000_000_000, views: 4 };
  const deps: ShareDependencies = {
    configured: async () => true, ipHash: () => "a".repeat(64), userId: async () => null,
    store: {
      configured: async () => true,
      create: async (...args) => { calls.push({ method: "create", args }); return metadata; },
      update: async (...args) => { calls.push({ method: "update", args }); return metadata; },
      changeExpiry: async (...args) => { calls.push({ method: "changeExpiry", args }); return metadata; },
      remove: async (...args) => { calls.push({ method: "remove", args }); },
      inspect: async (...args) => { calls.push({ method: "inspect", args }); return metadata; },
      get: async () => null,
      recordView: async () => {},
    },
  };
  return { calls, metadata, deps, handlers: createShareHandlers(deps) };
}

test("sharing is available to guests, defaults to seven days, and returns no management secrets", async () => {
  const { handlers, calls, metadata } = setup();
  const status = await handlers.status(request("GET"));
  assert.deepEqual(await status.json(), { enabled: true });
  const created = await handlers.create(request("POST", { id, token, snapshot }));
  assert.equal(created.status, 200);
  assert.deepEqual(await created.json(), metadata);
  assert.equal(calls[0].args[3], "7d");
  for (const expiry of ["7d", "30d", "never"] as const) {
    assert.equal((await handlers.create(request("POST", { id, token, snapshot, expiry }))).status, 200);
    assert.equal(calls.at(-1)?.args[3], expiry);
  }
  assert.equal(created.headers.get("cache-control"), "no-store");
  assert.equal(status.headers.get("cache-control"), "no-store");
});

test("management status requires its header capability and exposes only metadata", async () => {
  const { handlers, calls, metadata } = setup();
  assert.equal((await handlers.inspect(request("GET", undefined, { "x-share-token": "" }), id)).status, 403);
  assert.deepEqual(calls, []);
  const result = await handlers.inspect(request("GET"), id);
  // The owner's view count rides along; the token holder is the only caller.
  assert.deepEqual(await result.json(), { exists: true, expiresAt: metadata.expiresAt, updatedAt: metadata.updatedAt, expiry: metadata.expiry, views: metadata.views });
  assert.ok(!JSON.stringify(await (await handlers.inspect(request("GET"), id)).json()).includes(token));
});

test("expiry and snapshot changes cannot silently overwrite each other", async () => {
  const { handlers, calls } = setup();
  assert.equal((await handlers.changeExpiry(request("PATCH", { expiry: "never" }), id)).status, 200);
  assert.deepEqual(calls[0], { method: "changeExpiry", args: [id, token, "never"] });
  for (const body of [{}, { expiry: "tomorrow" }, { expiry: "7d", snapshot }, { expiry: "7d", token }]) {
    assert.equal((await handlers.changeExpiry(request("PATCH", body), id)).status, 400);
  }
  assert.equal((await handlers.update(request("PUT", { snapshot, expiry: "30d" }), id)).status, 400);
  assert.equal((await handlers.update(request("PUT", { snapshot }), id)).status, 200);
  assert.deepEqual(calls[1], { method: "update", args: [id, token, snapshot] });
  assert.equal(calls.length, 2);
});

test("all mutations reject missing or cross-site origins before accessing storage", async () => {
  const { handlers, calls } = setup();
  for (const headers of [{ origin: "" }, { origin: "https://attacker.example" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) {
    const create = request("POST", { id, token, snapshot }, headers);
    assert.equal((await handlers.create(create)).status, 403);
    assert.equal((await handlers.update(request("PUT", { snapshot }, headers), id)).status, 403);
    assert.equal((await handlers.changeExpiry(request("PATCH", { expiry: "never" }, headers), id)).status, 403);
    assert.equal((await handlers.remove(request("DELETE", undefined, headers), id)).status, 403);
  }
  assert.deepEqual(calls, []);
});

test("same-origin validation uses the actual Host when Next normalizes a loopback URL", async () => {
  const { handlers } = setup();
  const forwarded = (origin: string, host = "127.0.0.1:3105") => new Request("http://localhost:3105/api/share", {
    method: "POST", headers: { host, origin, "content-type": "application/json" }, body: JSON.stringify({ id, token, snapshot }),
  });
  assert.equal((await handlers.create(forwarded("http://127.0.0.1:3105"))).status, 200);
  assert.equal((await handlers.create(forwarded("http://localhost:3105"))).status, 403);
  assert.equal((await handlers.create(forwarded("https://attacker.example"))).status, 403);
  assert.equal((await handlers.create(forwarded("http://127.0.0.1:3105", "user@127.0.0.1:3105"))).status, 403);
});

test("whitelisted request bodies reject local records, private fields, and malformed content", async () => {
  const { handlers, calls } = setup();
  for (const body of [null, [], {}, { id, token, snapshot, account: "private" }, { id, token, snapshot: { ...snapshot, modelPhoto: imageData } }, { id, token, snapshot: { ...snapshot, pieces: [{ ...snapshot.pieces[0], id: "local-id" }] } }]) {
    assert.ok((await handlers.create(request("POST", body))).status >= 400);
  }
  assert.equal((await handlers.create(request("POST", { id, token, snapshot }, { "content-type": "text/plain" }))).status, 415);
  const invalidJson = new Request(`${origin}/api/share`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{" });
  assert.equal((await handlers.create(invalidJson)).status, 400);
  assert.equal((await handlers.remove(request("DELETE", {}), id)).status, 400);
  assert.deepEqual(calls, []);
});

test("streamed body limits work without or despite a misleading Content-Length", async () => {
  const { handlers, calls } = setup();
  for (const declared of [undefined, "1", String(MAX_SHARE_BODY_BYTES + 1)]) {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(MAX_SHARE_BODY_BYTES)); controller.enqueue(new Uint8Array(1)); },
      cancel() { canceled = true; },
    });
    const streamed = new Request(`${origin}/api/share`, {
      method: "POST", headers: { origin, "content-type": "application/json", ...(declared ? { "content-length": declared } : {}) },
      body: stream, duplex: "half",
    } as RequestInit);
    const result = await handlers.create(streamed);
    assert.equal(result.status, 413); assert.equal(result.headers.get("cache-control"), "no-store");
    if (declared !== String(MAX_SHARE_BODY_BYTES + 1)) assert.equal(canceled, true);
    else await stream.cancel();
  }
  assert.deepEqual(calls, []);
});

test("disabled sharing and database failures return safe no-store responses", async () => {
  const { handlers, deps, calls } = setup();
  deps.configured = async () => false;
  assert.deepEqual(await (await handlers.status(request("GET"))).json(), { enabled: false });
  assert.equal((await handlers.create(request("POST", { id, token, snapshot }))).status, 503);
  assert.deepEqual(calls, []);
  deps.configured = async () => true;
  deps.store.create = deps.store.update = deps.store.changeExpiry = deps.store.inspect = async () => { throw new Error(token); };
  deps.store.remove = async () => { throw new Error(token); };
  for (const result of [
    await handlers.create(request("POST", { id, token, snapshot })),
    await handlers.inspect(request("GET"), id),
    await handlers.update(request("PUT", { snapshot }), id),
    await handlers.changeExpiry(request("PATCH", { expiry: "never" }), id),
    await handlers.remove(request("DELETE"), id),
  ]) {
    assert.equal(result.status, 503); assert.equal(result.headers.get("cache-control"), "no-store"); assert.ok(!(await result.text()).includes(token));
  }
  deps.store.inspect = async () => { throw new ShareError("This share link is no longer available.", 410); };
  assert.equal((await handlers.inspect(request("GET"), id)).status, 410);
});

test("revocation passes its management token but returns only acknowledgement", async () => {
  const { handlers, calls } = setup();
  const result = await handlers.remove(request("DELETE"), id);
  assert.equal(result.status, 200); assert.deepEqual(await result.json(), { ok: true });
  assert.deepEqual(calls, [{ method: "remove", args: [id, token, "a".repeat(64)] }]);
});

test("revocation accepts the empty request stream supplied by Next", async () => {
  const { handlers, calls } = setup();
  const empty = new Request(`${origin}/api/share/${id}`, { method: "DELETE", headers: { origin, "x-share-token": token }, body: "" });
  assert.notEqual(empty.body, null);
  assert.equal((await handlers.remove(empty, id)).status, 200);
  assert.equal(calls[0].method, "remove");
});

test("copying shared pieces requires the current account and never writes to server storage", async () => {
  const { handlers, calls, deps, metadata } = setup();
  assert.equal((await handlers.copy(request("POST", { expectedUserId: "alice" }), id)).status, 401);
  deps.userId = async () => "alice";
  for (const body of [{}, { expectedUserId: "bob" }, { expectedUserId: null }]) {
    assert.equal((await handlers.copy(request("POST", body), id)).status, 409);
  }
  assert.equal((await handlers.copy(request("POST", { expectedUserId: "alice" }, { origin: "https://attacker.example" }), id)).status, 403);
  assert.equal((await handlers.copy(request("POST", { expectedUserId: "alice", snapshot }), id)).status, 400);
  assert.equal((await handlers.copy(request("POST", { expectedUserId: "alice" }), id)).status, 410);
  deps.store.get = async (value) => { calls.push({ method: "get", args: [value] }); return { snapshot, expiresAt: metadata.expiresAt, updatedAt: metadata.updatedAt }; };
  const result = await handlers.copy(request("POST", { expectedUserId: "alice" }), id);
  assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(await result.json(), { snapshot, userId: "alice" });
  assert.deepEqual(calls, [{ method: "get", args: [id] }]);
});
