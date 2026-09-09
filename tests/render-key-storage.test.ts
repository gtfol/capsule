import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { accountSpace, activateSpace, applySyncResponse, currentSpace, GUEST_SPACE, importGuestOnce, listStored, pendingChanges, readRenderApiKey, readSnapshot, subscribeToLocalChanges, writeRecord, writeRenderApiKey } from "../src/lib/db";
import { validateSyncRequest } from "../src/lib/server/sync-validation";
import type { Outfit } from "../src/lib/types";

Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });
// Deliberately invalid placeholders, never live API credentials.
const fixtureKey = (label: string) => `fake-render-key-for-${label}-tests-only`;
const outfit = (): Outfit => ({ id: crypto.randomUUID(), name: "Outfit", itemIds: [], imageData: "data:image/jpeg;base64,YQ==", createdAt: 1, updatedAt: 1 });

test("render credentials persist across reads, can be replaced, and can be removed", async () => {
  const space = accountSpace(crypto.randomUUID());
  assert.equal(await readRenderApiKey(space), null);
  await writeRenderApiKey(space, `  ${fixtureKey("first")}\n`);
  assert.equal(await readRenderApiKey(space), fixtureKey("first"));
  assert.equal(await readRenderApiKey(space), fixtureKey("first"));
  await writeRenderApiKey(space, fixtureKey("replacement"));
  assert.equal(await readRenderApiKey(space), fixtureKey("replacement"));
  await writeRenderApiKey(space, null);
  assert.equal(await readRenderApiKey(space), null);
  await writeRenderApiKey(space, fixtureKey("blank-removal"));
  await writeRenderApiKey(space, " \n ");
  assert.equal(await readRenderApiKey(space), null);
});

test("account changes never expose or remove another space's rendering credential", async () => {
  const first = accountSpace(crypto.randomUUID());
  const second = accountSpace(crypto.randomUUID());
  await Promise.all([writeRenderApiKey(first, fixtureKey("first-account")), writeRenderApiKey(second, fixtureKey("second-account"))]);
  await activateSpace(first);
  assert.equal(await readRenderApiKey(await currentSpace()), fixtureKey("first-account"));
  await activateSpace(second);
  assert.equal(await readRenderApiKey(await currentSpace()), fixtureKey("second-account"));
  await writeRenderApiKey(first, null);
  assert.equal(await readRenderApiKey(first), null);
  assert.equal(await readRenderApiKey(second), fixtureKey("second-account"));
});

test("guest import copies wardrobe records without copying or overwriting rendering credentials", async () => {
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  const guestOutfit = outfit();
  await writeRecord(GUEST_SPACE, "outfits", guestOutfit);
  await writeRenderApiKey(GUEST_SPACE, fixtureKey("guest"));
  await writeRenderApiKey(accountSpace(second), fixtureKey("existing-account"));
  await importGuestOnce(first);
  await importGuestOnce(second);
  assert.ok((await readSnapshot(accountSpace(first))).outfits.some((entry) => entry.id === guestOutfit.id));
  assert.equal(await readRenderApiKey(GUEST_SPACE), fixtureKey("guest"));
  assert.equal(await readRenderApiKey(accountSpace(first)), null);
  assert.equal(await readRenderApiKey(accountSpace(second)), fixtureKey("existing-account"));
});

test("render credentials never enter snapshots, stored records, sync changes, or sync notifications", async () => {
  const userId = crypto.randomUUID();
  const space = accountSpace(userId);
  const savedKey = fixtureKey("private");
  const notifications: string[] = [];
  const unsubscribe = subscribeToLocalChanges((changedSpace) => { notifications.push(changedSpace); });
  try {
    await writeRenderApiKey(space, savedKey);
    assert.deepEqual(notifications, []);
    assert.deepEqual(await listStored(space), []);
    assert.deepEqual(await pendingChanges(space), []);
    assert.deepEqual(await readSnapshot(space), { items: [], outfits: [], wishlist: [], referencePhoto: null });
    const rendered = outfit();
    await writeRecord(space, "outfits", rendered);
    const changes = await pendingChanges(space);
    assert.equal(changes.length, 1);
    const payload = validateSyncRequest({ expectedUserId: userId, cursor: 0, changes });
    assert.ok(!JSON.stringify(payload).includes(savedKey));
    assert.ok(!JSON.stringify(await readSnapshot(space)).includes(savedKey));
    await applySyncResponse(space, changes, { userId, results: [{ collection: "outfits", id: rendered.id, status: "ok", revision: 1 }], rows: [], cursor: 1, hasMore: false });
    assert.equal(await readRenderApiKey(space), savedKey);
    assert.deepEqual(await pendingChanges(space), []);
  } finally { unsubscribe(); }
});

test("failed writes and removals keep the previous credential intact", async (context) => {
  const space = accountSpace(crypto.randomUUID());
  const original = fixtureKey("original");
  await writeRenderApiKey(space, original);
  const put = context.mock.method(IDBObjectStore.prototype, "put", () => { throw new Error("Simulated storage failure"); });
  await assert.rejects(writeRenderApiKey(space, fixtureKey("replacement")), /storage failure/);
  put.mock.restore();
  assert.equal(await readRenderApiKey(space), original);
  const remove = context.mock.method(IDBObjectStore.prototype, "delete", () => { throw new Error("Simulated storage failure"); });
  await assert.rejects(writeRenderApiKey(space, null), /storage failure/);
  remove.mock.restore();
  assert.equal(await readRenderApiKey(space), original);
});
