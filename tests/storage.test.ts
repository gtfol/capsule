import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { accountSpace, applySyncResponse, GUEST_SPACE, importGuestOnce, listStored, pendingChanges, readSnapshot, removeRecord, syncCursor, writeRecord, writeReferencePhoto } from "../src/lib/db";
import type { Item, SyncResponse } from "../src/lib/types";
import { validateSyncRequest } from "../src/lib/server/sync-validation";

// Browser cross-tab messaging is separate from the storage transaction tests.
Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });
const item = (name = "Cotton shirt"): Item => ({
  id: crypto.randomUUID(), name, brand: "Example", size: "M", color: "White", category: "tops",
  price: "45", currency: "USD", description: "Cotton", purchaseUrl: "https://example.com/shirt",
  imageUrl: "https://example.com/shirt.jpg", imageData: "data:image/webp;base64,YQ==", createdAt: 1, updatedAt: 1,
});
const response = (userId: string, patch: Partial<SyncResponse> = {}): SyncResponse => ({ userId, results: [], rows: [], cursor: 0, hasMore: false, ...patch });

test("an empty space stays empty and writes persist with their pending token", async () => {
  const space = accountSpace(crypto.randomUUID());
  assert.deepEqual(await readSnapshot(space), { items: [], outfits: [], wishlist: [], referencePhoto: null });
  const shirt = item();
  await writeRecord(space, "items", shirt);
  assert.equal((await readSnapshot(space)).items[0].name, shirt.name);
  const stored = await listStored(space);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].revision, 0);
  assert.ok(stored[0].pendingToken);
  assert.equal((await pendingChanges(space))[0].record.id, shirt.id);
});

test("an acknowledgement cannot clear an edit made during the request", async () => {
  const userId = crypto.randomUUID();
  const space = accountSpace(userId);
  const shirt = item();
  await writeRecord(space, "items", shirt);
  const sent = await pendingChanges(space);
  await writeRecord(space, "items", { ...shirt, size: "L" });
  const latestToken = (await pendingChanges(space))[0].token;
  await applySyncResponse(space, sent, response(userId, {
    results: [{ id: shirt.id, collection: "items", status: "ok", revision: 10 }], cursor: 10,
    rows: [{ collection: "items", record: shirt, revision: 10 }],
  }));
  const remaining = await pendingChanges(space);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].token, latestToken);
  assert.equal(remaining[0].baseRevision, 10);
  assert.equal((remaining[0].record as Item).size, "L");
  assert.equal(await syncCursor(space), 10);
});

test("front, back, and side images survive local storage, sync validation, and a remote pull", async () => {
  const userId = crypto.randomUUID();
  const space = accountSpace(userId);
  const shirt: Item = { ...item(), backImageUrl: "https://example.com/shirt-back.jpg", backImageData: "data:image/webp;base64,Yg==", sideImageUrl: "https://example.com/shirt-side.jpg", sideImageData: "data:image/webp;base64,Yw==" };
  await writeRecord(space, "items", shirt);
  const local = (await readSnapshot(space)).items[0];
  assert.equal(local.imageData, shirt.imageData);
  assert.equal(local.backImageData, shirt.backImageData);
  assert.equal(local.sideImageData, shirt.sideImageData);
  const { changes } = validateSyncRequest({ expectedUserId: userId, cursor: 0, changes: await pendingChanges(space) });
  const otherUser = crypto.randomUUID();
  const otherDevice = accountSpace(otherUser);
  await applySyncResponse(otherDevice, [], response(otherUser, { cursor: 1, rows: [{ collection: "items", record: changes[0].record, revision: 1 }] }));
  const pulled = (await readSnapshot(otherDevice)).items[0];
  assert.equal(pulled.imageData, shirt.imageData);
  assert.equal(pulled.backImageUrl, shirt.backImageUrl);
  assert.equal(pulled.backImageData, shirt.backImageData);
  assert.equal(pulled.sideImageUrl, shirt.sideImageUrl);
  assert.equal(pulled.sideImageData, shirt.sideImageData);
  await writeRecord(space, "items", { ...local, backImageUrl: undefined, backImageData: undefined });
  const cleared = validateSyncRequest(JSON.parse(JSON.stringify({ expectedUserId: userId, cursor: 1, changes: await pendingChanges(space) }))).changes[0];
  await applySyncResponse(otherDevice, [], response(otherUser, { cursor: 2, rows: [{ collection: "items", record: cleared.record, revision: 2 }] }));
  assert.equal((await readSnapshot(otherDevice)).items[0].backImageData, undefined);
  assert.equal((await readSnapshot(otherDevice)).items[0].backImageUrl, undefined);
  assert.equal((await readSnapshot(otherDevice)).items[0].sideImageData, shirt.sideImageData);
  await writeRecord(space, "items", { ...local, sideImageUrl: "", sideImageData: "" });
  const clearedSide = validateSyncRequest({ expectedUserId: userId, cursor: 2, changes: await pendingChanges(space) }).changes[0];
  await applySyncResponse(otherDevice, [], response(otherUser, { cursor: 3, rows: [{ collection: "items", record: clearedSide.record, revision: 3 }] }));
  assert.equal((await readSnapshot(otherDevice)).items[0].sideImageData, "");
  assert.equal((await readSnapshot(otherDevice)).items[0].sideImageUrl, "");
});

test("remote pulls preserve dirty local edits and clean records accept newer revisions", async () => {
  const userId = crypto.randomUUID();
  const space = accountSpace(userId);
  const shirt = item();
  await writeRecord(space, "items", shirt);
  await applySyncResponse(space, [], response(userId, { cursor: 2, rows: [{ collection: "items", record: { ...shirt, name: "Remote" }, revision: 2 }] }));
  assert.equal((await readSnapshot(space)).items[0].name, shirt.name);
  const pending = await pendingChanges(space);
  await applySyncResponse(space, pending, response(userId, { results: [{ collection: "items", id: shirt.id, status: "ok", revision: 3 }], cursor: 3 }));
  assert.equal((await pendingChanges(space)).length, 0);
  await applySyncResponse(space, [], response(userId, { cursor: 4, rows: [{ collection: "items", record: { ...shirt, name: "New remote" }, revision: 4 }] }));
  assert.equal((await readSnapshot(space)).items[0].name, "New remote");
});

test("conflicting edits preserve a pending local copy and the server's original", async () => {
  const userId = crypto.randomUUID();
  const space = accountSpace(userId);
  const shirt = { ...item("Local name"), backImageUrl: "https://example.com/shirt-back.jpg", backImageData: "data:image/webp;base64,Yg==" };
  await writeRecord(space, "items", shirt);
  const sent = await pendingChanges(space);
  const conflicts = await applySyncResponse(space, sent, response(userId, {
    results: [{ collection: "items", id: shirt.id, status: "conflict", server: { collection: "items", record: { ...shirt, name: "Remote name" }, revision: 9 } }], cursor: 9,
  }));
  assert.equal(conflicts, 1);
  const snapshot = await readSnapshot(space);
  assert.equal(snapshot.items.length, 2);
  assert.equal(snapshot.items.find((i) => i.id === shirt.id)?.name, "Remote name");
  assert.equal(snapshot.items.find((i) => i.id !== shirt.id)?.name, "Local name (copy)");
  assert.equal(snapshot.items.find((i) => i.id !== shirt.id)?.backImageData, shirt.backImageData);
  assert.equal((await pendingChanges(space)).length, 1);
});

test("deletes stay queued as tombstones until acknowledged", async () => {
  const userId = crypto.randomUUID();
  const space = accountSpace(userId);
  const shirt = { ...item(), backImageUrl: "https://example.com/shirt-back.jpg", backImageData: "data:image/webp;base64,Yg==", sideImageUrl: "https://example.com/shirt-side.jpg", sideImageData: "data:image/webp;base64,Yw==" };
  await writeRecord(space, "items", shirt);
  await removeRecord(space, "items", shirt.id);
  assert.equal((await readSnapshot(space)).items.length, 0);
  const pending = await pendingChanges(space);
  assert.ok(pending[0].record.deletedAt);
  assert.equal(pending[0].record.imageData, "");
  assert.equal((pending[0].record as Item).backImageData, "");
  assert.equal((pending[0].record as Item).sideImageData, "");
  await applySyncResponse(space, pending, response(userId, { results: [{ collection: "items", id: shirt.id, status: "ok", revision: 6 }], cursor: 6 }));
  assert.equal((await pendingChanges(space)).length, 0);
  assert.ok((await listStored(space))[0].record.deletedAt);
});

test("guest import belongs only to the first account and reference photos never enter sync", async () => {
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  const shirt = item();
  await writeRecord(GUEST_SPACE, "items", shirt);
  await writeReferencePhoto(GUEST_SPACE, "data:image/webp;base64,cGhvdG8=");
  await importGuestOnce(first);
  await importGuestOnce(second);
  assert.equal((await readSnapshot(accountSpace(first))).items.length, 1);
  assert.equal((await readSnapshot(accountSpace(second))).items.length, 0);
  assert.equal((await readSnapshot(accountSpace(first))).referencePhoto, "data:image/webp;base64,cGhvdG8=");
  assert.equal((await readSnapshot(accountSpace(second))).referencePhoto, null);
  const changes = await pendingChanges(accountSpace(first));
  assert.equal(changes.length, 1);
  assert.ok(!JSON.stringify(changes).includes("cGhvdG8="));
  await assert.rejects(applySyncResponse(accountSpace(first), [], response(second)), /account changed/);
});
