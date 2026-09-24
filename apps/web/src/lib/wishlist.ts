import { MAX_ITEM_IMAGE_CHARS } from "./image-limits";
import type { Item, WishlistItem, WishlistSource } from "./types";

export const MAX_WISHLIST_SOURCES = 20;
export const MAX_PRICE_HISTORY = 1_000;
// Reserve room for all three photos, the sync envelope, and multibyte metadata.
export const MAX_WISHLIST_METADATA_BYTES = 500_000;
export interface PriceQuote { price: string; currency: string; source_url: string; fetched_at: number; }

export function normalizeListingUrl(value: string): string {
  try {
    const parsed = new URL(value.trim());
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.href.length > 8_000) throw new Error();
    parsed.hash = "";
    return parsed.href;
  } catch { throw new Error("Enter a valid http or https listing URL."); }
}

export function isWishlistCurrency(value: unknown): value is string {
  return typeof value === "string" && (value === "" || /^[A-Z]{3}$/.test(value));
}

export function wishlistPriceNumber(value: string): number | null {
  if (!value || value.length > 100 || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

function validateQuote(result: Omit<PriceQuote, "source_url">): number {
  const price = wishlistPriceNumber(result.price);
  if (price === null) throw new Error("The listing did not provide a valid price.");
  if (!isWishlistCurrency(result.currency)) throw new Error("Use a three-letter currency code, or leave it blank if unknown.");
  if (!Number.isSafeInteger(result.fetched_at) || result.fetched_at < 0 || result.fetched_at > 8_640_000_000_000_000) throw new Error("The price has an invalid fetch time.");
  return price;
}

export function assertWishlistLimits(item: WishlistItem): void {
  if (item.sources.length > MAX_WISHLIST_SOURCES) throw new Error(`A wishlist item can have up to ${MAX_WISHLIST_SOURCES} listing links.`);
  if (item.priceHistory.length > MAX_PRICE_HISTORY) throw new Error(`This item has reached its ${MAX_PRICE_HISTORY}-entry price history limit.`);
  if ((item.imageData?.length ?? 0) + (item.backImageData?.length ?? 0) + (item.sideImageData?.length ?? 0) > MAX_ITEM_IMAGE_CHARS) throw new Error("An item's images are too large.");
  const { imageData: _front, backImageData: _back, sideImageData: _side, ...metadata } = item;
  // The images have a separate character budget and their base64 is ASCII.
  void _front; void _back; void _side;
  if (new TextEncoder().encode(JSON.stringify(metadata)).length > MAX_WISHLIST_METADATA_BYTES) {
    throw new Error("This wishlist item's details and price history are too large to save. Shorten its description or listing links.");
  }
}

export function recomputeWishlistPrice(item: WishlistItem): WishlistItem {
  // A missing currency is unknown, even when two listings both omit it.
  const comparable = item.currency && isWishlistCurrency(item.currency)
    ? item.sources.filter((source) => !source.link_broken && source.currency === item.currency && wishlistPriceNumber(source.price) !== null)
    : [];
  const cheapest = comparable.reduce<WishlistSource | undefined>((best, source) => {
    if (!best || wishlistPriceNumber(source.price)! < wishlistPriceNumber(best.price)!) return source;
    return best;
  }, undefined);
  return {
    ...item,
    price: cheapest?.price ?? item.price,
    currentSourceUrl: cheapest?.url ?? "",
    link_broken: item.sources.some((source) => source.link_broken),
  };
}

export function createWishlistItem(item: Item, fetchedAt: number, initialQuote?: PriceQuote | null): WishlistItem {
  const purchaseUrl = item.purchaseUrl.trim() ? normalizeListingUrl(item.purchaseUrl) : "";
  if (!isWishlistCurrency(item.currency)) throw new Error("Use a three-letter currency code, or leave it blank if unknown.");
  if (item.price && wishlistPriceNumber(item.price) === null) throw new Error("Enter a valid price, or leave it blank if unknown.");
  let wishlist: WishlistItem = {
    ...item, purchaseUrl, rating: null, sources: [], priceHistory: [], link_broken: false, currentSourceUrl: "",
  };
  const quote = initialQuote === undefined ? (item.price && purchaseUrl ? { price: item.price, currency: item.currency, source_url: purchaseUrl, fetched_at: fetchedAt } : undefined) : initialQuote;
  if (quote) {
    const quoteUrl = normalizeListingUrl(quote.source_url);
    wishlist = applyPriceFetch(wishlist, quoteUrl, quote);
    // Confirming an edited price changes the current snapshot, never the
    // historical quote actually fetched from the page.
    if (quoteUrl === purchaseUrl) wishlist.sources = wishlist.sources.map((source) => ({ ...source, price: item.price, currency: item.currency }));
  }
  if (purchaseUrl && !wishlist.sources.some((source) => source.url === purchaseUrl)) {
    wishlist.sources.push({ url: purchaseUrl, price: quote ? "" : item.price, currency: item.currency, fetched_at: null, link_broken: false });
  }
  wishlist = recomputeWishlistPrice({ ...wishlist, price: item.price, currency: item.currency });
  assertWishlistLimits(wishlist);
  return wishlist;
}

export function applyPriceFetch(item: WishlistItem, url: string, result: Omit<PriceQuote, "source_url"> | null): WishlistItem {
  const normalized = normalizeListingUrl(url);
  const previous = item.sources.find((source) => source.url === normalized);
  if (!previous && item.sources.length >= MAX_WISHLIST_SOURCES) throw new Error(`A wishlist item can have up to ${MAX_WISHLIST_SOURCES} listing links.`);
  // A failed fetch must still be recordable when history is at capacity.
  if (result && item.priceHistory.length >= MAX_PRICE_HISTORY) throw new Error(`This item has reached its ${MAX_PRICE_HISTORY}-entry price history limit.`);
  const price = result ? validateQuote(result) : null;
  const olderSnapshot = result && previous?.fetched_at != null && result.fetched_at < previous.fetched_at;
  const source: WishlistSource = olderSnapshot ? previous! : result ? {
    url: normalized, price: result.price, currency: result.currency, fetched_at: result.fetched_at, link_broken: false,
  } : { url: normalized, price: previous?.price ?? "", currency: previous?.currency ?? "", fetched_at: previous?.fetched_at ?? null, link_broken: true };
  const updated = recomputeWishlistPrice({
    ...item,
    // Once a listing supplies the missing currency, it becomes possible to
    // compare its current quote. A known currency never changes implicitly.
    currency: !item.currency && result?.currency && !olderSnapshot ? result.currency : item.currency,
    sources: previous ? item.sources.map((entry) => entry.url === normalized ? source : entry) : [...item.sources, source],
    priceHistory: result ? [...item.priceHistory, { price: price!, currency: result.currency, source_url: normalized, fetched_at: result.fetched_at }] : item.priceHistory,
  });
  assertWishlistLimits(updated);
  return updated;
}

export function priceDropPercent(item: WishlistItem): number | null {
  if (!item.currentSourceUrl || !item.currency) return null;
  const current = wishlistPriceNumber(item.price);
  if (current === null) return null;
  const baseline = item.priceHistory.filter((entry) => entry.currency === item.currency)
    .reduce<(typeof item.priceHistory)[number] | undefined>((first, entry) => !first || entry.fetched_at < first.fetched_at ? entry : first, undefined);
  if (!baseline || baseline.price <= 0) return null;
  return (baseline.price - current) / baseline.price * 100;
}

export function formatPrice(price: string | number, currency: string): string {
  const amount = typeof price === "number" ? price : wishlistPriceNumber(price);
  if (amount === null || !Number.isFinite(amount) || amount < 0) return "—";
  if (currency && isWishlistCurrency(currency)) return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount);
}
