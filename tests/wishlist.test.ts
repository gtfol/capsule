import assert from "node:assert/strict";
import test from "node:test";
import type { Item } from "../src/lib/types";
import { applyPriceFetch, assertWishlistLimits, createWishlistItem, formatPrice, MAX_PRICE_HISTORY, MAX_WISHLIST_METADATA_BYTES, MAX_WISHLIST_SOURCES, normalizeListingUrl, priceDropPercent, recomputeWishlistPrice } from "../src/lib/wishlist";

const primary = "https://example.com/shirt";
const alternative = "https://other.example/shirt";
function item(overrides: Partial<Item> = {}): Item {
  return { id: crypto.randomUUID(), name: "Shirt", brand: "Example", size: "M", color: "White", category: "tops", price: "100", currency: "USD", description: "Cotton", purchaseUrl: primary, imageUrl: "https://example.com/shirt.jpg", createdAt: 1, updatedAt: 1, ...overrides };
}

test("confirmation preserves fetched history separately from an edited current price", () => {
  const wishlist = createWishlistItem(item({ price: "90", currency: "EUR" }), 99, { price: "100", currency: "USD", source_url: primary, fetched_at: 10 });
  assert.deepEqual(wishlist.priceHistory, [{ price: 100, currency: "USD", source_url: primary, fetched_at: 10 }]);
  assert.equal(wishlist.sources[0].price, "90");
  assert.equal(wishlist.sources[0].currency, "EUR");
  assert.equal(wishlist.price, "90");
  assert.equal(wishlist.currentSourceUrl, primary);
  assert.equal(wishlist.rating, null);
  assert.equal(priceDropPercent(wishlist), null);
});

test("a missing fetched quote never invents history from a manually confirmed price", () => {
  const wishlist = createWishlistItem(item({ price: "45" }), 100, null);
  assert.deepEqual(wishlist.priceHistory, []);
  assert.equal(wishlist.sources[0].fetched_at, null);
  assert.equal(wishlist.price, "45");
  const unknown = createWishlistItem(item({ price: "", currency: "" }), 100, null);
  assert.equal(unknown.currentSourceUrl, "");
  assert.equal(unknown.sources.length, 1);
});

test("changing a confirmed primary URL keeps the fetched quote with its actual source", () => {
  const wishlist = createWishlistItem(item({ purchaseUrl: alternative, price: "75" }), 100, { price: "100", currency: "USD", source_url: primary, fetched_at: 10 });
  assert.equal(wishlist.priceHistory[0].source_url, primary);
  assert.equal(wishlist.sources.find((source) => source.url === alternative)?.price, "");
  assert.equal(wishlist.sources.find((source) => source.url === alternative)?.fetched_at, null);
  assert.equal(wishlist.price, "100");
});

test("alternative listings share history and the cheapest comparable healthy source wins", () => {
  const original = createWishlistItem(item(), 1);
  const lower = applyPriceFetch(original, alternative, { price: "75", currency: "USD", fetched_at: 2 });
  assert.equal(original.sources.length, 1);
  assert.equal(original.priceHistory.length, 1);
  assert.equal(lower.price, "75");
  assert.equal(lower.currentSourceUrl, alternative);
  assert.deepEqual(lower.priceHistory.map((entry) => entry.source_url), [primary, alternative]);
  assert.equal(priceDropPercent(lower), 25);
  const rebound = applyPriceFetch(lower, alternative, { price: "110", currency: "USD", fetched_at: 3 });
  assert.equal(rebound.price, "100");
  assert.equal(rebound.currentSourceUrl, primary);
  assert.equal(rebound.priceHistory.length, 3);
});

test("a failed link keeps its last quote, is excluded from the minimum, and clears on recovery", () => {
  const lower = applyPriceFetch(createWishlistItem(item(), 1), alternative, { price: "50", currency: "USD", fetched_at: 2 });
  const failed = applyPriceFetch(lower, alternative, null);
  assert.equal(failed.link_broken, true);
  assert.equal(failed.price, "100");
  assert.equal(failed.sources[1].price, "50");
  assert.equal(failed.sources[1].fetched_at, 2);
  assert.equal(failed.priceHistory.length, 2);
  const allFailed = applyPriceFetch(failed, primary, null);
  assert.equal(allFailed.currentSourceUrl, "");
  assert.equal(allFailed.price, "100");
  assert.equal(priceDropPercent(allFailed), null);
  const recovered = applyPriceFetch(allFailed, alternative, { price: "45", currency: "USD", fetched_at: 4 });
  assert.equal(recovered.price, "45");
  assert.equal(recovered.link_broken, true); // The original listing is still broken.
  const restored = applyPriceFetch(recovered, primary, { price: "80", currency: "USD", fetched_at: 5 });
  assert.equal(restored.link_broken, false);
});

test("mixed and unknown currencies are retained without comparing raw numbers", () => {
  const usd = createWishlistItem(item(), 1);
  const eur = applyPriceFetch(usd, alternative, { price: "1", currency: "EUR", fetched_at: 2 });
  const unknown = applyPriceFetch(eur, "https://unknown.example/shirt", { price: "0", currency: "", fetched_at: 3 });
  assert.equal(unknown.price, "100");
  assert.equal(unknown.currentSourceUrl, primary);
  assert.equal(unknown.priceHistory.length, 3);
  assert.equal(priceDropPercent(unknown), 0);
  const switched = recomputeWishlistPrice({ ...unknown, currency: "EUR" });
  assert.equal(switched.price, "1");
  assert.equal(switched.currentSourceUrl, alternative);
  const allUnknown = createWishlistItem(item({ currency: "" }), 1);
  assert.equal(allUnknown.currentSourceUrl, "");
  assert.equal(priceDropPercent(allUnknown), null);
});

test("a first known quote currency enables the current price after an unknown initial price", () => {
  const original = createWishlistItem(item({ price: "", currency: "" }), 1, null);
  const fetched = applyPriceFetch(original, primary, { price: "50", currency: "USD", fetched_at: 2 });
  assert.equal(fetched.currency, "USD");
  assert.equal(fetched.price, "50");
  assert.equal(fetched.currentSourceUrl, primary);
  const different = applyPriceFetch(fetched, alternative, { price: "20", currency: "EUR", fetched_at: 3 });
  assert.equal(different.currency, "USD");
  assert.equal(different.price, "50");
});

test("older responses append observations without rolling back a newer source snapshot", () => {
  const original = createWishlistItem(item(), 1);
  const newer = applyPriceFetch(original, primary, { price: "80", currency: "USD", fetched_at: 200 });
  const late = applyPriceFetch(newer, primary, { price: "100", currency: "USD", fetched_at: 100 });
  assert.equal(late.price, "80");
  assert.equal(late.sources[0].fetched_at, 200);
  assert.equal(late.priceHistory.length, 3);
  assert.equal(late.priceHistory[2].fetched_at, 100);
  const broken = applyPriceFetch(newer, primary, null);
  const staleRecovery = applyPriceFetch(broken, primary, { price: "100", currency: "USD", fetched_at: 100 });
  assert.equal(staleRecovery.link_broken, true);
  assert.equal(staleRecovery.currentSourceUrl, "");
  assert.equal(staleRecovery.price, "80");
});

test("free items are valid; zero baselines and missing comparisons have no percentage drop", () => {
  const free = applyPriceFetch(createWishlistItem(item(), 1), primary, { price: "0", currency: "USD", fetched_at: 2 });
  assert.equal(free.price, "0");
  assert.equal(priceDropPercent(free), 100);
  assert.equal(priceDropPercent(createWishlistItem(item({ price: "0" }), 1)), null);
  assert.equal(formatPrice("0", "USD"), "$0.00");
  assert.equal(formatPrice("", "USD"), "—");
  assert.equal(formatPrice("25", ""), "25");
});

test("listing URLs normalize fragments without merging distinct product variants", () => {
  const wishlist = applyPriceFetch(createWishlistItem(item(), 1), `${primary}#details`, { price: "90", currency: "USD", fetched_at: 2 });
  assert.equal(wishlist.sources.length, 1);
  assert.equal(wishlist.priceHistory[1].source_url, primary);
  assert.notEqual(normalizeListingUrl(`${primary}?variant=a`), normalizeListingUrl(`${primary}?variant=b`));
  for (const url of ["javascript:alert(1)", "file:///tmp/photo", "https://user:pass@example.com", ""]) assert.throws(() => normalizeListingUrl(url), /valid/);
});

test("history and source limits reject additions without silently deleting any history", () => {
  const wishlist = createWishlistItem(item(), 1);
  const full = { ...wishlist, priceHistory: Array.from({ length: MAX_PRICE_HISTORY }, (_, index) => ({ ...wishlist.priceHistory[0], fetched_at: index })) };
  assert.throws(() => applyPriceFetch(full, primary, { price: "1", currency: "USD", fetched_at: 2_000 }), /history limit/);
  const failed = applyPriceFetch(full, primary, null);
  assert.equal(failed.priceHistory.length, MAX_PRICE_HISTORY);
  assert.equal(failed.link_broken, true);
  const sources = { ...wishlist, sources: Array.from({ length: MAX_WISHLIST_SOURCES }, (_, index) => ({ ...wishlist.sources[0], url: `https://example.com/${index}` })) };
  assert.throws(() => applyPriceFetch(sources, alternative, null), /20 listing/);
  assert.equal(sources.sources.length, MAX_WISHLIST_SOURCES);
});

test("wishlist metadata is byte bounded independently of the photo allowance", () => {
  const wishlist = createWishlistItem(item(), 1);
  assert.throws(() => assertWishlistLimits({ ...wishlist, description: "字".repeat(Math.ceil(MAX_WISHLIST_METADATA_BYTES / 3)) }), /too large to save/);
  assert.doesNotThrow(() => assertWishlistLimits({ ...wishlist, imageData: `data:image/webp;base64,${"A".repeat(2_700_000)}` }));
  assert.doesNotThrow(() => assertWishlistLimits({ ...wishlist, sideImageData: `data:image/webp;base64,${"A".repeat(2_700_000)}` }));
  const photo = `data:image/webp;base64,${"A".repeat(1_000_000)}`;
  assert.throws(() => assertWishlistLimits({ ...wishlist, imageData: photo, backImageData: photo, sideImageData: photo }), /images are too large/);
});

test("invalid prices, currency codes, and timestamps cannot create history", () => {
  const wishlist = createWishlistItem(item(), 1);
  for (const price of ["-1", "Infinity", "NaN", "1e3", "$10", "", " 1 "]) assert.throws(() => applyPriceFetch(wishlist, primary, { price, currency: "USD", fetched_at: 2 }), /valid price/);
  for (const currency of ["usd", "$", "US D", "USDD"]) assert.throws(() => applyPriceFetch(wishlist, primary, { price: "10", currency, fetched_at: 2 }), /currency/);
  for (const fetched_at of [-1, NaN, Infinity, 0.5]) assert.throws(() => applyPriceFetch(wishlist, primary, { price: "10", currency: "USD", fetched_at }), /fetch time/);
  assert.equal(wishlist.priceHistory.length, 1);
});
