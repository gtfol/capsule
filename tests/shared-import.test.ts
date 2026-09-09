import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { accountSpace, activateSpace, importSharedRecords, moveWishlistToWardrobe, pendingChanges, readSnapshot, writeRecord } from "../src/lib/db";
import { validateSyncRequest } from "../src/lib/server/sync-validation";
import { createWishlistItem } from "../src/lib/wishlist";
import type { Item } from "../src/lib/types";

Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });
const item = (): Item => ({ id: crypto.randomUUID(), name: "Shared shirt", brand: "", category: "tops", size: "", color: "", price: "25", currency: "USD", description: "", purchaseUrl: "", imageUrl: "", imageData: "data:image/png;base64,YQ==", createdAt: 1, updatedAt: 1 });
const noop = () => {};

test("concurrent shared imports persist one complete selection and queue sync", async () => {
  const userId = crypto.randomUUID();
  const space = accountSpace(userId);
  await activateSpace(space);
  const results = await Promise.all(Array.from({ length: 5 }, () => importSharedRecords(space, "items", [item(), item()], "same-selection", noop)));
  assert.equal(results.filter((result) => !result.alreadyAdded).length, 1);
  assert.ok(results.every((result) => result.count === 2));
  assert.equal((await readSnapshot(space)).items.length, 2);
  const changes = await pendingChanges(space);
  assert.equal(changes.length, 2);
  assert.equal(validateSyncRequest({ expectedUserId: userId, cursor: 0, changes }).changes.length, 2);
});

test("a collision rolls back every piece and the receipt without overwriting", async () => {
  const space = accountSpace(crypto.randomUUID());
  await activateSpace(space);
  const existing = item();
  await writeRecord(space, "items", existing);
  await assert.rejects(importSharedRecords(space, "items", [item(), { ...existing, name: "Wrong" }], "retry", noop), /could not be added/);
  assert.deepEqual((await readSnapshot(space)).items.map((piece) => piece.name), ["Shared shirt"]);
  assert.deepEqual(await importSharedRecords(space, "items", [item(), item()], "retry", noop), { count: 2, alreadyAdded: false });
});

test("account switches abort in-progress imports and guests cannot import", async () => {
  const space = accountSpace(crypto.randomUUID());
  await activateSpace(space);
  let checks = 0;
  await assert.rejects(importSharedRecords(space, "items", [item(), item()], "guard", () => { if (++checks === 6) throw new Error("Account changed"); }), /Account changed/);
  assert.equal((await readSnapshot(space)).items.length, 0);
  await activateSpace(accountSpace(crypto.randomUUID()));
  await assert.rejects(importSharedRecords(space, "items", [item()], "guard", noop), /active wardrobe changed/);
  await assert.rejects(importSharedRecords("guest", "items", [item()], "guest", noop), /Sign in/);
});

test("linkless copied wishlist pieces sync without inventing quotes or ratings", async () => {
  const userId = crypto.randomUUID();
  const space = accountSpace(userId);
  await activateSpace(space);
  const wishlist = createWishlistItem(item(), 1, null);
  assert.deepEqual(wishlist.sources, []);
  assert.deepEqual(wishlist.priceHistory, []);
  assert.equal(wishlist.rating, null);
  assert.equal(wishlist.price, "25");
  await importSharedRecords(space, "wishlist", [wishlist], "linkless", noop);
  assert.equal((await readSnapshot(space)).wishlist.length, 1);
  assert.equal(validateSyncRequest({ expectedUserId: userId, cursor: 0, changes: await pendingChanges(space) }).changes.length, 1);
  assert.equal(createWishlistItem(item(), 1).priceHistory.length, 0);
});

test("repeat imports restore deleted copies without duplicating or overwriting survivors", async () => {
  const space = accountSpace(crypto.randomUUID());
  await activateSpace(space);
  const first = item(), second = item();
  await importSharedRecords(space, "items", [first, second], "restore", noop);
  await writeRecord(space, "items", { ...first, deletedAt: Date.now() });
  await writeRecord(space, "items", { ...second, name: "My edited survivor" });
  const restored = item(), unused = item();
  assert.deepEqual(await importSharedRecords(space, "items", [restored, unused], "restore", noop), { count: 1, alreadyAdded: false });
  const alive = (await readSnapshot(space)).items;
  assert.equal(alive.length, 2);
  assert.ok(alive.some((piece) => piece.id === restored.id));
  assert.ok(alive.some((piece) => piece.id === second.id && piece.name === "My edited survivor"));
  assert.ok(!alive.some((piece) => piece.id === first.id || piece.id === unused.id));
  assert.deepEqual(await importSharedRecords(space, "items", [item(), item()], "restore", noop), { count: 2, alreadyAdded: true });
});

test("moving a copied wishlist piece into wardrobe allows a fresh wishlist copy", async () => {
  const space = accountSpace(crypto.randomUUID());
  await activateSpace(space);
  const wishlist = createWishlistItem(item(), 1, null);
  await importSharedRecords(space, "wishlist", [wishlist], "moved-copy", noop);
  await moveWishlistToWardrobe(space, wishlist.id);
  const replacement = createWishlistItem(item(), 2, null);
  assert.deepEqual(await importSharedRecords(space, "wishlist", [replacement], "moved-copy", noop), { count: 1, alreadyAdded: false });
  const snapshot = await readSnapshot(space);
  assert.equal(snapshot.items.length, 1);
  assert.deepEqual(snapshot.wishlist.map((piece) => piece.id), [replacement.id]);
});

test("concurrent restores create one replacement per missing copy", async () => {
  const space = accountSpace(crypto.randomUUID());
  await activateSpace(space);
  const original = item();
  await importSharedRecords(space, "items", [original], "parallel-restore", noop);
  await writeRecord(space, "items", { ...original, deletedAt: Date.now() });
  const results = await Promise.all(Array.from({ length: 5 }, () => importSharedRecords(space, "items", [item()], "parallel-restore", noop)));
  assert.equal(results.filter((result) => !result.alreadyAdded).length, 1);
  assert.equal((await readSnapshot(space)).items.length, 1);
});
