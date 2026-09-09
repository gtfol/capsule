import assert from "node:assert/strict";
import test from "node:test";
import { mergeWishlistEdits } from "../src/lib/wishlist-editor";
import { applyPriceFetch, createWishlistItem } from "../src/lib/wishlist";

function piece() {
  return createWishlistItem({ id: crypto.randomUUID(), name: "Shirt", brand: "Brand", category: "tops", size: "", color: "", price: "100", currency: "USD", description: "", purchaseUrl: "https://example.com/shirt", imageUrl: "https://example.com/shirt.jpg", createdAt: 1, updatedAt: 1 }, 1);
}

test("saving an open editor preserves price observations and failures from another tab", () => {
  const initial = piece();
  const edited = { ...initial, name: "Renamed shirt", rating: 3.5 };
  const latest = applyPriceFetch(applyPriceFetch(initial, "https://other.example/shirt", { price: "75", currency: "USD", fetched_at: 2 }), initial.purchaseUrl, null);
  const merged = mergeWishlistEdits(latest, edited);
  assert.equal(merged.name, "Renamed shirt");
  assert.equal(merged.rating, 3.5);
  assert.equal(merged.price, "75");
  assert.equal(merged.currentSourceUrl, "https://other.example/shirt");
  assert.equal(merged.link_broken, true);
  assert.deepEqual(merged.priceHistory, latest.priceHistory);
  assert.deepEqual(merged.sources, latest.sources);
});

test("editing a link retains its old history and queues a new unpriced source", () => {
  const initial = piece();
  const merged = mergeWishlistEdits(initial, { ...initial, purchaseUrl: "https://new.example/shirt#description" });
  assert.equal(merged.purchaseUrl, "https://new.example/shirt");
  assert.deepEqual(merged.sources.at(-1), { url: "https://new.example/shirt", price: "", currency: "", fetched_at: null, link_broken: false });
  assert.deepEqual(merged.priceHistory, initial.priceHistory);
  assert.equal(merged.sources.length, 2);
  assert.equal(mergeWishlistEdits(merged, { ...merged, purchaseUrl: "https://new.example/shirt#top" }).sources.length, 2);
});

test("linkless shared pieces remain editable and clearing a link preserves prior observations", () => {
  const initial = piece();
  const cleared = mergeWishlistEdits(initial, { ...initial, purchaseUrl: "" });
  assert.equal(cleared.purchaseUrl, "");
  assert.deepEqual(cleared.sources, initial.sources);
  assert.deepEqual(cleared.priceHistory, initial.priceHistory);
  const linkless = createWishlistItem({ ...initial, purchaseUrl: "" }, 1, null);
  const edited = mergeWishlistEdits(linkless, { ...linkless, name: "Shared shirt", size: "M" });
  assert.equal(edited.size, "M");
  assert.equal(edited.name, "Shared shirt");
  assert.deepEqual(edited.sources, []);
  assert.deepEqual(edited.priceHistory, []);
});
