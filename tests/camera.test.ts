import assert from "node:assert/strict";
import test from "node:test";
import { cameraErrorMessage, requestCameraStream, stopCameraStream } from "../src/lib/camera";

function stream() {
  const stops = [0, 0];
  return { media: { getTracks: () => stops.map((_, index) => ({ stop() { stops[index]++; } })) } as unknown as MediaStream, stops };
}

test("camera acquisition requests video only with a front-facing preference and stops every track on close", async () => {
  const source = stream();
  const controller = new AbortController();
  const media = await requestCameraStream(controller.signal, { async getUserMedia(constraints) {
    assert.equal(constraints?.audio, false);
    assert.deepEqual((constraints?.video as MediaTrackConstraints).facingMode, { ideal: "user" });
    return source.media;
  } });
  assert.equal(media, source.media);
  assert.deepEqual(source.stops, [0, 0]);
  controller.abort();
  assert.deepEqual(source.stops, [1, 1]);
});

test("an already closed picker never requests camera permission", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(requestCameraStream(controller.signal, { async getUserMedia() { calls++; return stream().media; } }), { name: "AbortError" });
  assert.equal(calls, 0);
});

test("a camera granted after closing or leaving Outfits immediately stops", async () => {
  const source = stream();
  let grant!: (stream: MediaStream) => void;
  const controller = new AbortController();
  const pending = requestCameraStream(controller.signal, { getUserMedia: () => new Promise((resolve) => { grant = resolve; }) });
  controller.abort();
  grant(source.media);
  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(source.stops, [1, 1]);
});

test("a late old permission result cannot stop a newly opened camera", async () => {
  const oldSource = stream();
  const newSource = stream();
  const oldController = new AbortController();
  const newController = new AbortController();
  let grantOld!: (stream: MediaStream) => void;
  const oldRequest = requestCameraStream(oldController.signal, { getUserMedia: () => new Promise((resolve) => { grantOld = resolve; }) });
  oldController.abort();
  await requestCameraStream(newController.signal, { async getUserMedia() { return newSource.media; } });
  grantOld(oldSource.media);
  await assert.rejects(oldRequest, { name: "AbortError" });
  assert.deepEqual(oldSource.stops, [1, 1]);
  assert.deepEqual(newSource.stops, [0, 0]);
  newController.abort();
  assert.deepEqual(newSource.stops, [1, 1]);
});

test("cleanup releases remaining tracks even if one track fails to stop", () => {
  let stopped = false;
  stopCameraStream({ getTracks: () => [{ stop() { throw new Error("device gone"); } }, { stop() { stopped = true; } }] } as unknown as MediaStream);
  assert.equal(stopped, true);
});

test("permission denial and missing cameras produce actionable messages", async () => {
  await assert.rejects(requestCameraStream(new AbortController().signal, { async getUserMedia() { throw new DOMException("denied", "NotAllowedError"); } }), { name: "NotAllowedError" });
  assert.match(cameraErrorMessage(new DOMException("denied", "NotAllowedError")), /Camera access was blocked/);
  assert.match(cameraErrorMessage(new DOMException("missing", "NotFoundError")), /No camera was found/);
  assert.match(cameraErrorMessage(new DOMException("busy", "NotReadableError")), /camera is in use/);
});
