import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { accountSpace, moveWishlistToWardrobe, pendingChanges, readSnapshot, writeRecord } from "../src/lib/db";
import { initialPhotos, savePhotoState } from "../src/lib/photo-editor";
import { assignPhotoSlot } from "../src/lib/photo-slots";
import { validateSyncRequest } from "../src/lib/server/sync-validation";
import { applyPriceFetch, createWishlistItem } from "../src/lib/wishlist";
import { mergeWishlistEdits } from "../src/lib/wishlist-editor";

Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });
const front = "data:image/webp;base64,YQ==";
const back = "data:image/webp;base64,Yg==";
const side = "data:image/webp;base64,Yw==";
const cutout = "data:image/webp;base64,ZA==";
const piece = () => createWishlistItem({
  id: crypto.randomUUID(), name: "Shirt", brand: "", size: "", color: "", category: "tops",
  price: "50", currency: "USD", description: "", purchaseUrl: "", imageUrl: "",
  createdAt: 1, updatedAt: 1,
}, 1, null);

test("a photo-only wishlist item saves three independent views and reopens offline", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Offline"); };
  try {
    const item = piece();
    const photos = initialPhotos(item, [], [front, back, side]);
    const saved = { ...item, ...await savePhotoState(photos) };
    const userId = crypto.randomUUID();
    const space = accountSpace(userId);
    await writeRecord(space, "wishlist", saved);
    const reloaded = (await readSnapshot(space)).wishlist[0];
    assert.equal(reloaded.imageData, front);
    assert.equal(reloaded.backImageData, back);
    assert.equal(reloaded.sideImageData, side);
    assert.equal(reloaded.purchaseUrl, "");
    assert.equal(reloaded.price, "50");
    assert.deepEqual(reloaded.priceHistory, []);
    assert.deepEqual(reloaded.sources, []);
    const reopened = initialPhotos(reloaded, [], []);
    assert.equal(reopened.choices.length, 3);
    assert.equal(reopened.choices.find((choice) => choice.id === reopened.backId)?.imageData, back);
    assert.equal(reopened.choices.find((choice) => choice.id === reopened.sideId)?.imageData, side);
    const changes = await pendingChanges(space);
    const parsed = validateSyncRequest(JSON.parse(JSON.stringify({ expectedUserId: userId, cursor: 0, changes })));
    const record = parsed.changes[0].record;
    assert.ok("sideImageData" in record);
    assert.equal(record.sideImageData, side);
  } finally { globalThis.fetch = originalFetch; }
});

test("cutout edits and optional-view removal survive moving to wardrobe", async () => {
  const item = { ...piece(), imageUrl: "https://example.com/front.jpg", imageData: front, backImageUrl: "https://example.com/back.jpg", backImageData: back, sideImageData: side };
  const photos = initialPhotos(item, [], []);
  photos.choices = photos.choices.map((choice) => choice.id === photos.sideId ? { ...choice, cutout, useCutout: true } : choice);
  photos.backId = null;
  const edited = { ...item, ...await savePhotoState(photos) };
  assert.equal(edited.imageData, front);
  assert.equal(edited.backImageData, undefined);
  assert.equal(edited.backImageUrl, undefined);
  assert.equal(edited.sideImageData, cutout);
  const space = accountSpace(crypto.randomUUID());
  await writeRecord(space, "wishlist", item);
  const moved = await moveWishlistToWardrobe(space, item.id, (current) => mergeWishlistEdits(current, edited));
  assert.equal(moved?.imageData, front);
  assert.equal(moved?.backImageData, undefined);
  assert.equal(moved?.backImageUrl, undefined);
  assert.equal(moved?.sideImageData, cutout);
  assert.equal((await readSnapshot(space)).wishlist.length, 0);
  assert.equal((await readSnapshot(space)).items[0].sideImageData, cutout);
  assert.equal(item.sideImageData, side);
});

test("swapping uploaded views and rejecting a cutout preserves originals and newer prices", async () => {
  const item = createWishlistItem({ ...piece(), purchaseUrl: "https://example.com/shirt", imageData: front, backImageData: back, sideImageData: side }, 1);
  const photos = initialPhotos(item, [], []);
  photos.choices = photos.choices.map((choice) => choice.id === photos.sideId ? { ...choice, cutout, useCutout: false } : choice);
  const swapped = assignPhotoSlot(photos, "front", photos.sideId!);
  const edited = { ...item, ...await savePhotoState(swapped) };
  const latest = applyPriceFetch(item, item.purchaseUrl, { price: "40", currency: "USD", fetched_at: 2 });
  const merged = mergeWishlistEdits(latest, edited);
  assert.equal(merged.imageData, side);
  assert.equal(merged.backImageData, back);
  assert.equal(merged.sideImageData, front);
  assert.equal(merged.price, "40");
  assert.deepEqual(merged.priceHistory, latest.priceHistory);
  assert.deepEqual(merged.sources, latest.sources);
});

test("fetched gallery choices do not replace cached photos or duplicate their URLs", async () => {
  const item = { ...piece(), imageUrl: "https://example.com/front.jpg", imageData: front, sideImageUrl: "https://example.com/side.jpg", sideImageData: side };
  const photos = initialPhotos(item, [item.imageUrl, item.sideImageUrl, "https://example.com/back.jpg"], []);
  assert.equal(photos.choices.length, 3);
  const saved = await savePhotoState(photos);
  assert.equal(saved.imageData, front);
  assert.equal(saved.sideImageData, side);
  assert.equal(saved.backImageData, undefined);
});

test("duplicate uploads stay exclusive and an empty or unavailable selection cannot save", async () => {
  const photos = initialPhotos(piece(), [], [front, front, back]);
  assert.equal(photos.choices.length, 2);
  assert.equal(photos.sideId, null);
  await assert.rejects(savePhotoState(initialPhotos(piece(), [], [])), /Choose a front photo/);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 404 });
  try {
    const unavailable = initialPhotos({ ...piece(), imageData: front, sideImageUrl: "https://example.com/unavailable.jpg" }, [], []);
    await assert.rejects(savePhotoState(unavailable), /could not be saved/);
    assert.equal(unavailable.choices[0].imageData, front);
  } finally { globalThis.fetch = originalFetch; }
});
