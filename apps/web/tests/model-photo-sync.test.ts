import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { accountSpace, applyReferencePhoto, readReferencePhotoState, readSnapshot, writeReferencePhoto } from "../src/lib/db";
import { saveReferencePhoto, syncReferencePhoto } from "../src/lib/model-photo-sync";
Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });
test("legacy photos migrate once, remote changes/removals win, guests stay local, and accounts stay separate", async () => {
  const original = globalThis.fetch, user = crypto.randomUUID(), space = accountSpace(user);
  let server: { imageData: string | null; revision: number } = { imageData: null, revision: 0 }, writes = 0;
  globalThis.fetch = async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("x-capsule-user"), user);
    if (init?.method === "PUT") {
      writes++;
      const body = JSON.parse(String(init.body));
      if (body.expectedRevision !== server.revision) return Response.json({ error: { code: "REVISION_CONFLICT", message: "reload" } }, { status: 409 });
      server = { imageData: body.imageData, revision: server.revision + 1 };
    }
    return Response.json(server);
  };
  try {
    await writeReferencePhoto(space, "legacy");
    await syncReferencePhoto(user); assert.equal(server.imageData, "legacy"); assert.equal(writes, 1);
    await syncReferencePhoto(user); assert.equal(writes, 1);
    server = { imageData: "from iphone", revision: 2 };
    await syncReferencePhoto(user); assert.equal((await readSnapshot(space)).referencePhoto, "from iphone");
    await saveReferencePhoto(space, "replacement"); assert.equal(server.imageData, "replacement");
    await saveReferencePhoto(space, null); assert.equal(server.imageData, null);
    // A stale second browser must respect the remote tombstone, never re-upload its legacy copy.
    await writeReferencePhoto(space, "old local photo");
    await syncReferencePhoto(user); assert.equal(server.imageData, null); assert.equal((await readSnapshot(space)).referencePhoto, null);
    const before = writes;
    await saveReferencePhoto("guest", "guest only"); assert.equal(writes, before);
    assert.equal((await readSnapshot(accountSpace("different"))).referencePhoto, null);
    // An old GET response cannot overwrite a newer local result.
    const snapshot = await readReferencePhotoState(space);
    await applyReferencePhoto(space, snapshot, { imageData: "newest", revision: 10 });
    await applyReferencePhoto(space, snapshot, { imageData: "stale response", revision: 9 });
    assert.equal((await readSnapshot(space)).referencePhoto, "newest");
    globalThis.fetch = async () => { throw new TypeError("offline"); };
    await assert.rejects(() => saveReferencePhoto(space, "unsaved"));
    assert.equal((await readSnapshot(space)).referencePhoto, "newest");
  } finally { globalThis.fetch = original; }
});
