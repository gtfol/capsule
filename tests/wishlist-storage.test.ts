import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { accountSpace, applySyncResponse, deleteWishlistRecord, GUEST_SPACE, importGuestOnce, listStored, moveWishlistToWardrobe, pendingChanges, readSnapshot, removeRecord, updateWishlistRecord, writeRecord, type StoredRecord } from "../src/lib/db";
import { validateSyncRequest } from "../src/lib/server/sync-validation";
import { useWardrobe } from "../src/lib/store";
import type { Item, SyncResponse, WishlistItem } from "../src/lib/types";
import { applyPriceFetch, createWishlistItem } from "../src/lib/wishlist";

Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });
const primary = "https://example.com/shirt";
function item(): Item {
  return { id: crypto.randomUUID(), name: "Shirt", brand: "Example", size: "M", color: "White", category: "tops", price: "100", currency: "USD", description: "Cotton", purchaseUrl: primary, imageUrl: "https://example.com/shirt.jpg", imageData: "data:image/webp;base64,YQ==", backImageData: "data:image/png;base64,Yg==", sideImageUrl: "https://example.com/shirt-side.jpg", sideImageData: "data:image/webp;base64,Yw==", createdAt: 1, updatedAt: 1 };
}
const response = (userId: string, patch: Partial<SyncResponse> = {}): SyncResponse => ({ userId, results: [], rows: [], cursor: 0, hasMore: false, ...patch });

test("wishlist records persist separately from owned items with the same ID", async () => {
  const space = accountSpace(crypto.randomUUID());
  const owned = item();
  const wishlist = createWishlistItem({ ...owned, name: "Wishlist shirt" }, 1);
  await writeRecord(space, "items", owned);
  await writeRecord(space, "wishlist", wishlist);
  const snapshot = await readSnapshot(space);
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.wishlist.length, 1);
  assert.equal(snapshot.items[0].name, "Shirt");
  assert.equal(snapshot.wishlist[0].name, "Wishlist shirt");
  assert.equal((await readSnapshot(accountSpace(crypto.randomUUID()))).wishlist.length, 0);
});

test("wishlist history, rating, sources, and photos survive validation and another device's pull", async () => {
  const userId = crypto.randomUUID();
  const space = accountSpace(userId);
  const wishlist = { ...applyPriceFetch(createWishlistItem(item(), 1), "https://other.example/shirt", { price: "80", currency: "USD", fetched_at: 2 }), rating: 3.5 };
  await writeRecord(space, "wishlist", wishlist);
  const sent = await pendingChanges(space);
  const parsed = validateSyncRequest(JSON.parse(JSON.stringify({ expectedUserId: userId, cursor: 0, changes: sent })));
  const otherUser = crypto.randomUUID();
  const otherSpace = accountSpace(otherUser);
  await applySyncResponse(otherSpace, [], response(otherUser, { cursor: 1, rows: [{ collection: "wishlist", record: parsed.changes[0].record, revision: 1 }] }));
  const pulled = (await readSnapshot(otherSpace)).wishlist[0];
  assert.equal(pulled.rating, 3.5);
  assert.equal(pulled.price, "80");
  assert.equal(pulled.backImageData, wishlist.backImageData);
  assert.equal(pulled.sideImageUrl, wishlist.sideImageUrl);
  assert.equal(pulled.sideImageData, wishlist.sideImageData);
  assert.deepEqual(pulled.priceHistory, wishlist.priceHistory);
  assert.deepEqual(pulled.sources, wishlist.sources);
  await applySyncResponse(space, sent, response(userId, { cursor: 1, results: [{ collection: "wishlist", id: wishlist.id, status: "ok", revision: 1 }] }));
  assert.equal((await pendingChanges(space)).length, 0);
});

test("atomic fetch updates retain simultaneous metadata and history edits", async () => {
  const space = accountSpace(crypto.randomUUID());
  const wishlist = createWishlistItem(item(), 1);
  await writeRecord(space, "wishlist", wishlist);
  await Promise.all([
    updateWishlistRecord(space, wishlist.id, (current) => ({ ...current, name: "Edited name", rating: 4.5 })),
    updateWishlistRecord(space, wishlist.id, (current) => applyPriceFetch(current, primary, { price: "90", currency: "USD", fetched_at: 2 })),
    updateWishlistRecord(space, wishlist.id, (current) => applyPriceFetch(current, primary, { price: "80", currency: "USD", fetched_at: 3 })),
  ]);
  const stored = (await readSnapshot(space)).wishlist[0];
  assert.equal(stored.name, "Edited name");
  assert.equal(stored.rating, 4.5);
  assert.equal(stored.priceHistory.length, 3);
  assert.equal(stored.price, "80");
  await assert.rejects(updateWishlistRecord(space, wishlist.id, () => { throw new Error("Transform failed"); }), /Transform failed/);
  assert.deepEqual((await readSnapshot(space)).wishlist[0], stored);
});

test("wishlist tombstones remove all three images and delayed requests cannot resurrect them", async () => {
  const space = accountSpace(crypto.randomUUID());
  const wishlist = createWishlistItem(item(), 1);
  await writeRecord(space, "wishlist", wishlist);
  await removeRecord(space, "wishlist", wishlist.id);
  const result = await updateWishlistRecord(space, wishlist.id, (current) => applyPriceFetch(current, primary, null));
  assert.equal(result, null);
  assert.equal((await readSnapshot(space)).wishlist.length, 0);
  const pending = (await pendingChanges(space))[0];
  assert.ok(pending.record.deletedAt);
  assert.equal(pending.record.imageData, "");
  assert.equal((pending.record as WishlistItem).backImageData, "");
  assert.equal((pending.record as WishlistItem).sideImageData, "");
  assert.equal((pending.record as WishlistItem).priceHistory.length, 1);
});

test("guest wishlist import remains restricted to the first account", async () => {
  const wishlist = createWishlistItem(item(), 1);
  await writeRecord(GUEST_SPACE, "wishlist", wishlist);
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  await importGuestOnce(first);
  await importGuestOnce(second);
  assert.ok((await readSnapshot(accountSpace(first))).wishlist.some((entry) => entry.id === wishlist.id));
  assert.equal((await readSnapshot(accountSpace(second))).wishlist.length, 0);
  assert.ok((await pendingChanges(accountSpace(first))).some((entry) => entry.collection === "wishlist"));
});

test("moving a wishlist item is atomic, carries edited photos and fields, and queues both collections", async () => {
  const space = accountSpace(crypto.randomUUID());
  const wishlist = { ...createWishlistItem(item(), 1), rating: 4.5 };
  await writeRecord(space, "wishlist", wishlist);
  const owned = await moveWishlistToWardrobe(space, wishlist.id, (current) => ({ ...current, size: "L", name: "Purchased shirt" }));
  assert.ok(owned);
  assert.equal(owned.size, "L");
  assert.equal(owned.name, "Purchased shirt");
  assert.equal(owned.imageData, wishlist.imageData);
  assert.equal(owned.backImageData, wishlist.backImageData);
  assert.equal(owned.sideImageUrl, wishlist.sideImageUrl);
  assert.equal(owned.sideImageData, wishlist.sideImageData);
  assert.ok(owned.createdAt > wishlist.createdAt);
  for (const key of ["rating", "priceHistory", "sources", "link_broken", "currentSourceUrl"]) assert.ok(!(key in owned));
  const snapshot = await readSnapshot(space);
  assert.equal(snapshot.wishlist.length, 0);
  assert.equal(snapshot.items.length, 1);
  const pending = await pendingChanges(space);
  assert.equal(pending.length, 2);
  const tombstone = pending.find((entry) => entry.collection === "wishlist")!.record as WishlistItem;
  assert.ok(tombstone.deletedAt);
  assert.equal(tombstone.imageData, "");
  assert.equal(tombstone.backImageData, "");
  assert.equal(tombstone.sideImageData, "");
  assert.equal(tombstone.priceHistory.length, 1);
  assert.doesNotThrow(() => validateSyncRequest({ expectedUserId: "user", cursor: 0, changes: pending }));
  assert.equal(await moveWishlistToWardrobe(space, wishlist.id), null);
  assert.equal((await readSnapshot(space)).items.length, 1);
});

test("move never overwrites an owned ID, and concurrent duplicate moves only create one piece", async () => {
  const space = accountSpace(crypto.randomUUID());
  const existing = item();
  const wishlist = createWishlistItem({ ...existing, name: "New purchase" }, 1);
  await writeRecord(space, "items", existing);
  await writeRecord(space, "wishlist", wishlist);
  const results = await Promise.all([moveWishlistToWardrobe(space, wishlist.id), moveWishlistToWardrobe(space, wishlist.id)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.notEqual(results.find(Boolean)?.id, existing.id);
  const snapshot = await readSnapshot(space);
  assert.equal(snapshot.items.length, 2);
  assert.equal(snapshot.items.find((entry) => entry.id === existing.id)?.name, existing.name);
});

test("a failed second write rolls back the complete move", async (context) => {
  const space = accountSpace(crypto.randomUUID());
  const wishlist = createWishlistItem(item(), 1);
  await writeRecord(space, "wishlist", wishlist);
  const before = await listStored(space);
  const original = IDBObjectStore.prototype.put;
  const mocked = context.mock.method(IDBObjectStore.prototype, "put", function (this: IDBObjectStore, value: StoredRecord) {
    if (value.collection === "items") throw new Error("Simulated browser storage failure");
    return original.call(this, value);
  });
  await assert.rejects(moveWishlistToWardrobe(space, wishlist.id), /Simulated/);
  mocked.mock.restore();
  assert.deepEqual(await listStored(space), before);
  const snapshot = await readSnapshot(space);
  assert.equal(snapshot.wishlist.length, 1);
  assert.equal(snapshot.items.length, 0);
});

test("guest moves stay local to their space and store operations reject account changes", async () => {
  const wishlist = createWishlistItem(item(), 1);
  await writeRecord(GUEST_SPACE, "wishlist", wishlist);
  const account = accountSpace(crypto.randomUUID());
  assert.equal(await moveWishlistToWardrobe(account, wishlist.id), null);
  const owned = await moveWishlistToWardrobe(GUEST_SPACE, wishlist.id);
  assert.ok(owned);
  assert.equal((await readSnapshot(account)).items.length, 0);
  useWardrobe.setState({ ready: true, space: account });
  await assert.rejects(useWardrobe.getState().updateWishlistItem(wishlist.id, (current) => current, GUEST_SPACE), /account changed/);
  await assert.rejects(useWardrobe.getState().moveWishlistToWardrobe(wishlist.id, GUEST_SPACE), /account changed/);
});

test("account changes while storage is opening abort delayed fetch updates and moves", async () => {
  const first = accountSpace(crypto.randomUUID());
  const second = accountSpace(crypto.randomUUID());
  const wishlist = createWishlistItem(item(), 1);
  await writeRecord(first, "wishlist", wishlist);
  useWardrobe.setState({ ready: true, space: first });
  const update = useWardrobe.getState().updateWishlistItem(wishlist.id, (current) => applyPriceFetch(current, primary, null), first);
  useWardrobe.setState({ space: second });
  await assert.rejects(update, /account changed/);
  assert.equal((await readSnapshot(first)).wishlist[0].link_broken, false);

  useWardrobe.setState({ ready: true, space: first });
  const move = useWardrobe.getState().moveWishlistToWardrobe(wishlist.id, first);
  useWardrobe.setState({ space: second });
  await assert.rejects(move, /account changed/);
  assert.equal((await readSnapshot(first)).wishlist.length, 1);
  assert.equal((await readSnapshot(first)).items.length, 0);
});

test("deletion returns the exact latest record so Undo preserves updates absent from the UI", async () => {
  const space = accountSpace(crypto.randomUUID());
  const wishlist = createWishlistItem(item(), 1);
  await writeRecord(space, "wishlist", wishlist);
  useWardrobe.setState({ ready: true, space, wishlist: [wishlist] });
  const newer = { ...applyPriceFetch(wishlist, primary, { price: "80", currency: "USD", fetched_at: 2 }), rating: 4.5, backImageData: "data:image/png;base64,Yw==", sideImageData: "data:image/webp;base64,ZA==" };
  await writeRecord(space, "wishlist", newer);
  const latest = (await readSnapshot(space)).wishlist[0];
  assert.equal(useWardrobe.getState().wishlist[0].priceHistory.length, 1);
  const removed = await useWardrobe.getState().deleteWishlistItem(wishlist.id, space);
  assert.deepEqual(removed, latest);
  const tombstone = (await pendingChanges(space))[0].record as WishlistItem;
  assert.ok(tombstone.deletedAt);
  assert.equal(tombstone.imageData, "");
  assert.equal(tombstone.backImageData, "");
  assert.equal(tombstone.sideImageData, "");
  assert.equal(await deleteWishlistRecord(space, wishlist.id), null);
  assert.equal(await deleteWishlistRecord(space, crypto.randomUUID()), null);
  assert.ok(removed);
  await writeRecord(space, "wishlist", removed);
  const restored = (await readSnapshot(space)).wishlist[0];
  assert.deepEqual(restored.priceHistory, newer.priceHistory);
  assert.equal(restored.rating, 4.5);
  assert.equal(restored.imageData, newer.imageData);
  assert.equal(restored.backImageData, newer.backImageData);
  assert.equal(restored.sideImageData, newer.sideImageData);
  assert.ok(!restored.deletedAt);
});

test("deletion atomically captures an earlier queued price update and rolls back guard failures", async () => {
  const space = accountSpace(crypto.randomUUID());
  const wishlist = createWishlistItem(item(), 1);
  await writeRecord(space, "wishlist", wishlist);
  const update = updateWishlistRecord(space, wishlist.id, (current) => applyPriceFetch(current, primary, { price: "70", currency: "USD", fetched_at: 2 }));
  const deletion = deleteWishlistRecord(space, wishlist.id);
  const [updated, removed] = await Promise.all([update, deletion]);
  assert.deepEqual(removed, updated);
  assert.equal(removed?.price, "70");
  assert.ok(removed);
  await writeRecord(space, "wishlist", removed);
  const before = await listStored(space);
  await assert.rejects(deleteWishlistRecord(space, wishlist.id, () => { throw new Error("Guard failed"); }), /Guard failed/);
  assert.deepEqual(await listStored(space), before);
});

test("deleting a wishlist item rejects account changes before or during the read", async () => {
  const first = accountSpace(crypto.randomUUID());
  const second = accountSpace(crypto.randomUUID());
  const wishlist = createWishlistItem(item(), 1);
  await writeRecord(first, "wishlist", wishlist);
  useWardrobe.setState({ ready: true, space: second });
  await assert.rejects(useWardrobe.getState().deleteWishlistItem(wishlist.id, first), /account changed/);
  useWardrobe.setState({ ready: true, space: first });
  const deletion = useWardrobe.getState().deleteWishlistItem(wishlist.id, first);
  useWardrobe.setState({ space: second });
  await assert.rejects(deletion, /account changed/);
  assert.equal((await readSnapshot(first)).wishlist.length, 1);
});
