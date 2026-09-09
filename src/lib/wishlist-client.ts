import type { WishlistPriceQuote } from "./wishlist-editor";

// This only runs after a user requests a price check.
export async function fetchWishlistPrice(url: string, signal: AbortSignal): Promise<WishlistPriceQuote> {
  const response = await fetch("/api/price", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }), signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
  });
  const data = await response.json();
  signal.throwIfAborted();
  if (!response.ok) throw new Error(data.error || "This listing could not be checked. Try again.");
  if (typeof data.price !== "string" || !data.price.trim() || !Number.isFinite(Number(data.price)) || Number(data.price) < 0 || !/^[A-Z]{3}$/.test(data.currency) || !Number.isSafeInteger(data.fetched_at)) {
    throw new Error("No current price was found on this listing.");
  }
  return { price: data.price, currency: data.currency, source_url: url, fetched_at: data.fetched_at };
}
