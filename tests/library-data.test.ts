import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { activateSpace, deleteLibrary, listStored, openDatabase, pendingChanges, readLibrarySnapshot, writeRecord, writeReferencePhoto } from "../src/lib/db";
import { libraryExport, supportUrl } from "../src/lib/library-data";
import { createWishlistItem } from "../src/lib/wishlist";
import { validateSyncRequest } from "../src/lib/server/sync-validation";
import type { Item } from "../src/lib/types";
Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });
const guard = () => {};
function item(): Item { return { id: crypto.randomUUID(), name: "Personal shirt", brand: "Private brand", category: "tops", size: "M", color: "White", description: "Private notes", price: "10", currency: "USD", purchaseUrl: "https://shop.test/shirt", imageUrl: "", imageData: "data:image/png;base64,YQ==", backImageData: "data:image/png;base64,Yg==", sideImageData: "data:image/png;base64,Yw==", createdAt: 1, updatedAt: 1 }; }
async function seed(space: string) {
  const piece = item();
  await writeRecord(space, "items", piece);
  await writeRecord(space, "wishlist", { ...createWishlistItem(item(), 1), rating: 4.5 });
  await writeRecord(space, "outfits", { id: crypto.randomUUID(), name: "Outfit", itemIds: [piece.id], imageData: "data:image/png;base64,YQ==", createdAt: 1, updatedAt: 1 });
  await writeReferencePhoto(space, "data:image/png;base64,Yg==");
  return piece;
}
test("export retains personal content and all image views without exporting credentials or sync internals", async () => {
  const space = `account:${crypto.randomUUID()}`;
  await activateSpace(space); await seed(space);
  const snapshot = await readLibrarySnapshot(space, guard);
  Object.assign(snapshot.items[0], { apiKey: "secret", token: "private-token", revision: 42 });
  const result = libraryExport(snapshot, new Date(0));
  assert.equal(result.version, 1); assert.equal(result.exportedAt, new Date(0).toISOString());
  assert.equal(result.wardrobe[0].backImageData, snapshot.items[0].backImageData);
  assert.equal(result.wardrobe[0].sideImageData, snapshot.items[0].sideImageData);
  assert.equal(result.wishlist[0].rating, 4.5);
  assert.ok(result.outfits[0].imageData); assert.ok(result.modelPhoto);
  assert.doesNotMatch(JSON.stringify(result), /secret|private-token|revision|account:/);
});
test("deletion is scoped, clears photos and details, and queues valid scrubbed sync tombstones", async () => {
  const user = crypto.randomUUID(), space = `account:${user}`, other = `account:${crypto.randomUUID()}`;
  await activateSpace(space); await seed(space); await seed(other);
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction("meta", "readwrite"); tx.objectStore("meta").put({ key: `${space}|share-link|wardrobe`, value: { token: "keep-control" } }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  await deleteLibrary(space, guard);
  assert.deepEqual(await readLibrarySnapshot(space, guard), { items: [], wishlist: [], outfits: [], referencePhoto: null });
  assert.equal((await listStored(other)).length, 3);
  const changes = await pendingChanges(space); assert.equal(changes.length, 3);
  assert.doesNotMatch(JSON.stringify(changes), /Personal shirt|Private brand|Private notes|base64|shop.test/);
  assert.equal(validateSyncRequest({ expectedUserId: user, cursor: 0, changes }).changes.length, 3);
  const token = await new Promise<unknown>((resolve) => { const req = db.transaction("meta").objectStore("meta").get(`${space}|share-link|wardrobe`); req.onsuccess = () => resolve(req.result); });
  assert.ok(token);
});
test("guest deletion physically removes records and account switches reject export and deletion", async () => {
  await activateSpace("guest"); await seed("guest");
  await deleteLibrary("guest", guard); assert.equal((await listStored("guest")).length, 0);
  const space = `account:${crypto.randomUUID()}`; await seed(space);
  await assert.rejects(readLibrarySnapshot(space, guard), /changed/);
  await assert.rejects(deleteLibrary(space, guard), /changed/);
  assert.equal((await listStored(space)).length, 3);
});
test("a guard failure during deletion rolls the transaction back", async () => {
  const space = `account:${crypto.randomUUID()}`; await activateSpace(space); await seed(space);
  let calls = 0;
  await assert.rejects(deleteLibrary(space, () => { if (++calls === 4) throw new Error("switched"); }), /switched/);
  assert.equal((await readLibrarySnapshot(space, guard)).items.length, 1);
  assert.ok((await readLibrarySnapshot(space, guard)).referencePhoto);
});
test("support stays hidden until a Stripe hosted payment link is configured", () => {
  for (const invalid of [undefined, "", "javascript:alert(1)", "https://buy.stripe.com.evil.test/a", "https://user:pass@buy.stripe.com/a"]) assert.equal(supportUrl(invalid), null);
  assert.equal(supportUrl("https://buy.stripe.com/test_link"), "https://buy.stripe.com/test_link");
});
