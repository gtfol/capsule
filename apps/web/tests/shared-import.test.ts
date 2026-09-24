import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { accountSpace, activateSpace, importSharedRecords, moveWishlistToWardrobe, pendingChanges, readSnapshot, writeRecord } from "../src/lib/db";
import { validateSyncRequest } from "../src/lib/server/sync-validation";
import { createWishlistItem } from "../src/lib/wishlist";
import type { Item } from "../src/lib/types";
import { pieceSourceKey } from "../src/lib/piece-identity";

Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });
const item = (): Item => ({ id: crypto.randomUUID(), name: "Shared shirt", brand: "", category: "tops", size: "", color: "", price: "25", currency: "USD", description: "", purchaseUrl: "", imageUrl: "", imageData: "data:image/png;base64,YQ==", createdAt: 1, updatedAt: 1 });
const noop = () => {};

test("concurrent shared imports persist one complete selection and queue sync", async () => {
  const userId = crypto.randomUUID();
  const space = accountSpace(userId);
  await activateSpace(space);
  const results = await Promise.all(Array.from({ length: 5 }, () => importSharedRecords(space, "items", [item(), item()], "same-selection", noop)));
  assert.equal(results.filter((result) => !result.alreadyAdded).length, 1);
  assert.ok(results.every((result) => result.count + result.skipped === 2));
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
  const result = await importSharedRecords(space, "items", [item(), item()], "retry", noop);
  assert.equal(result.count, 2); assert.equal(result.skipped, 0);
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
  assert.deepEqual(await importSharedRecords(space, "items", [restored, unused], "restore", noop), { count: 1, skipped: 1, alreadyAdded: false, itemIds: [restored.id, second.id] });
  const alive = (await readSnapshot(space)).items;
  assert.equal(alive.length, 2);
  assert.ok(alive.some((piece) => piece.id === restored.id));
  assert.ok(alive.some((piece) => piece.id === second.id && piece.name === "My edited survivor"));
  assert.ok(!alive.some((piece) => piece.id === first.id || piece.id === unused.id));
  assert.deepEqual(await importSharedRecords(space, "items", [item(), item()], "restore", noop), { count: 0, skipped: 2, alreadyAdded: true, itemIds: [restored.id, second.id] });
});

test("moving a copied wishlist piece into wardrobe allows a fresh wishlist copy", async () => {
  const space = accountSpace(crypto.randomUUID());
  await activateSpace(space);
  const wishlist = createWishlistItem(item(), 1, null);
  await importSharedRecords(space, "wishlist", [wishlist], "moved-copy", noop);
  await moveWishlistToWardrobe(space, wishlist.id);
  const replacement = createWishlistItem(item(), 2, null);
  assert.deepEqual(await importSharedRecords(space, "wishlist", [replacement], "moved-copy", noop), { count: 1, skipped: 0, alreadyAdded: false, itemIds: [replacement.id] });
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

test("own shares and overlapping selections from different links skip existing identities", async () => {
  const space = accountSpace(crypto.randomUUID());
  await activateSpace(space);
  const own = item();
  await writeRecord(space, "items", own);
  const copyOfOwn = { ...item(), sourceKey: pieceSourceKey(own) };
  const first = await importSharedRecords(space, "items", [copyOfOwn], "my-own-link", noop);
  assert.deepEqual(first, { count: 0, skipped: 1, alreadyAdded: true, itemIds: [own.id] });
  const shared = { ...item(), sourceKey: pieceSourceKey(item()) };
  await importSharedRecords(space, "items", [shared], "single-piece", noop);
  const unique = item();
  const batch = await importSharedRecords(space, "items", [copyOfOwn, { ...shared, id: crypto.randomUUID(), name: "Changed on another link" }, unique], "whole-outfit", noop);
  assert.deepEqual(batch, { count: 1, skipped: 2, alreadyAdded: false, itemIds: [own.id, shared.id, unique.id] });
  assert.equal((await readSnapshot(space)).items.length, 3);
  assert.equal((await readSnapshot(space)).items.find((piece) => piece.id === shared.id)?.name, "Shared shirt");
});

test("concurrent different links and repeated pieces in one selection share a single copy", async () => {
  const space = accountSpace(crypto.randomUUID());
  await activateSpace(space);
  const sourceKey = pieceSourceKey(item());
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => importSharedRecords(space, "wishlist", [createWishlistItem({ ...item(), sourceKey }, 1, null), createWishlistItem({ ...item(), sourceKey }, 1, null)], `link-${i}`, noop)));
  assert.equal(results.reduce((total, result) => total + result.count, 0), 1);
  assert.equal(results.reduce((total, result) => total + result.skipped, 0), 9);
  assert.equal((await readSnapshot(space)).wishlist.length, 1);
});

test("URL duplicates skip without overwriting, while variants and destinations stay independent", async () => {
  const space = accountSpace(crypto.randomUUID());
  await activateSpace(space);
  const existing = { ...item(), purchaseUrl: "https://shop.example/a?variant=1", size: "M", color: "Black" };
  await writeRecord(space, "wishlist", createWishlistItem(existing, 1, null));
  const incoming = { ...existing, id: crypto.randomUUID(), purchaseUrl: `${existing.purchaseUrl}&utm_source=friend`, name: "Different title" };
  const result = await importSharedRecords(space, "wishlist", [createWishlistItem(incoming, 1, null)], "same-url", noop);
  assert.equal(result.count, 0);
  assert.deepEqual(result.itemIds, [existing.id]);
  assert.equal((await readSnapshot(space)).wishlist[0].name, existing.name);
  assert.equal((await importSharedRecords(space, "items", [incoming], "purchased", noop)).count, 1);
  assert.equal((await importSharedRecords(space, "items", [{ ...incoming, id: crypto.randomUUID(), size: "L" }], "another-size", noop)).count, 1);
});

test("source identities survive sync and wishlist moves even when a new local ID is needed", async () => {
  const userId = crypto.randomUUID();
  const space = accountSpace(userId);
  await activateSpace(space);
  const original = item();
  const wishlist = createWishlistItem(original, 1, null);
  await writeRecord(space, "wishlist", wishlist);
  await writeRecord(space, "items", { ...original, deletedAt: 10 });
  const moved = await moveWishlistToWardrobe(space, wishlist.id);
  assert.ok(moved);
  assert.notEqual(moved.id, wishlist.id);
  assert.equal(moved.sourceKey, pieceSourceKey(wishlist));
  const changes = validateSyncRequest({ expectedUserId: userId, cursor: 0, changes: await pendingChanges(space) }).changes;
  const synced = changes.find((change) => change.record.id === moved.id)!.record as Item;
  assert.equal(synced.sourceKey, moved.sourceKey);
  // Another browser sees the synced record, without this browser's receipts.
  const otherBrowser = accountSpace(crypto.randomUUID());
  await activateSpace(otherBrowser);
  await writeRecord(otherBrowser, "items", synced);
  const duplicate = await importSharedRecords(otherBrowser, "items", [{ ...item(), sourceKey: moved.sourceKey }], "different-link", noop);
  assert.equal(duplicate.count, 0);
  assert.deepEqual(duplicate.itemIds, [moved.id]);
});
