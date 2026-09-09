import assert from "node:assert/strict";
import test from "node:test";
import { MAX_ITEM_IMAGE_CHARS } from "../src/lib/image-limits";
import { validateSyncRequest } from "../src/lib/server/sync-validation";
import type { WishlistItem } from "../src/lib/types";
import { createWishlistItem, MAX_PRICE_HISTORY, MAX_WISHLIST_SOURCES } from "../src/lib/wishlist";

const sourceUrl = "https://example.com/shirt";
function wishlist(): WishlistItem {
  return createWishlistItem({ id: crypto.randomUUID(), name: "Shirt", brand: "Example", size: "M", color: "White", category: "tops", price: "100", currency: "USD", description: "Cotton", purchaseUrl: sourceUrl, imageUrl: "https://example.com/shirt.jpg", createdAt: 1, updatedAt: 1 }, 1);
}
function validate(record: unknown) {
  return validateSyncRequest({ expectedUserId: "user", cursor: 0, changes: [{ collection: "wishlist", baseRevision: 0, token: crypto.randomUUID(), record }] });
}

test("wishlist sync supports half stars, unquoted links, and strips unrelated fields", () => {
  const record = wishlist();
  record.rating = 4.5;
  record.sources.push({ url: "https://other.example/shirt", price: "", currency: "", fetched_at: null, link_broken: false });
  const parsed = validate({ ...record, userId: "wrong", opinions: "not retained" }).changes[0].record;
  assert.deepEqual(parsed, { ...record, deletedAt: null });
  for (const rating of [null, 0.5, 1, 2.5, 5]) assert.doesNotThrow(() => validate({ ...record, rating }));
});

test("wishlist sync rejects invalid rating values", () => {
  for (const rating of [undefined, 0, -1, 5.5, 3.25, "5", NaN, Infinity]) assert.throws(() => validate({ ...wishlist(), rating }), /rating/);
});

test("wishlist sync rejects malformed quotes, timestamps, and currency codes", () => {
  for (const price of [-1, NaN, Infinity, "20", null]) {
    const record = wishlist();
    assert.throws(() => validate({ ...record, priceHistory: [{ ...record.priceHistory[0], price }] }), /price/);
  }
  for (const fetched_at of [null, undefined, -1, 0.1, Infinity, "1"]) {
    const record = wishlist();
    assert.throws(() => validate({ ...record, priceHistory: [{ ...record.priceHistory[0], fetched_at }] }), /timestamp/);
  }
  for (const currency of [undefined, "usd", "$", "US", 3]) {
    const record = wishlist();
    assert.throws(() => validate({ ...record, currency }), /currency|field/);
    assert.throws(() => validate({ ...record, sources: [{ ...record.sources[0], currency }] }), /currency/);
    assert.throws(() => validate({ ...record, priceHistory: [{ ...record.priceHistory[0], currency }] }), /currency/);
  }
});

test("wishlist sync rejects invalid, missing, duplicate, or unrelated listing links", () => {
  for (const url of ["", "javascript:alert(1)", "https://name:secret@example.com", "invalid"]) {
    const record = wishlist();
    assert.throws(() => validate({ ...record, sources: [{ ...record.sources[0], url }] }), /link|URL/);
  }
  const record = wishlist();
  assert.throws(() => validate({ ...record, sources: [record.sources[0], { ...record.sources[0], url: `${sourceUrl}#photo` }] }), /twice/);
  assert.throws(() => validate({ ...record, purchaseUrl: "https://other.example/shirt" }), /missing from/);
  assert.throws(() => validate({ ...record, priceHistory: [{ ...record.priceHistory[0], source_url: "https://other.example/shirt" }] }), /unknown listing/);
});

test("wishlist sync enforces source, history, and combined metadata budgets", () => {
  const record = wishlist();
  assert.throws(() => validate({ ...record, sources: Array.from({ length: MAX_WISHLIST_SOURCES + 1 }, (_, index) => ({ ...record.sources[0], url: `https://example.com/${index}` })) }), /sources/);
  assert.throws(() => validate({ ...record, sources: [] }), /sources/);
  assert.throws(() => validate({ ...record, priceHistory: Array.from({ length: MAX_PRICE_HISTORY + 1 }, () => record.priceHistory[0]) }), /history/);
  const longUrl = `https://example.com/${"a".repeat(6_000)}`;
  const oversized = {
    ...record, purchaseUrl: longUrl, currentSourceUrl: longUrl,
    sources: [{ ...record.sources[0], url: longUrl }],
    priceHistory: Array.from({ length: 100 }, () => ({ ...record.priceHistory[0], source_url: longUrl })),
  };
  assert.throws(() => validate(oversized), /too large to save/);
  const prefix = "data:image/png;base64,";
  const accepted = { ...record, imageData: prefix + "A".repeat(Math.floor((MAX_ITEM_IMAGE_CHARS - prefix.length) / 4) * 4) };
  assert.doesNotThrow(() => validate(accepted));
  const parsed = validate(accepted).changes[0];
  assert.ok(new TextEncoder().encode(JSON.stringify(parsed)).length < 3_500_000);
});

test("wishlist sync verifies current price and broken status against its source snapshots", () => {
  const record = wishlist();
  assert.throws(() => validate({ ...record, link_broken: "false" }), /link status/);
  assert.throws(() => validate({ ...record, link_broken: true }), /inconsistent/);
  assert.throws(() => validate({ ...record, price: "1" }), /inconsistent/);
  assert.throws(() => validate({ ...record, currentSourceUrl: "https://other.example/shirt" }), /inconsistent/);
  assert.throws(() => validate({ ...record, sources: [{ ...record.sources[0], link_broken: true }] }), /inconsistent/);
  const stale = { ...record, link_broken: true, currentSourceUrl: "", sources: [{ ...record.sources[0], link_broken: true }] };
  assert.doesNotThrow(() => validate(stale));
  const unknown = createWishlistItem({ ...record, currency: "" }, 1);
  assert.doesNotThrow(() => validate(unknown));
});
