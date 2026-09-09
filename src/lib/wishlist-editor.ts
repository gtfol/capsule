import type { WishlistItem } from "./types";
import { MAX_WISHLIST_SOURCES, normalizeListingUrl, recomputeWishlistPrice } from "./wishlist";

export interface WishlistPriceQuote { price: string; currency: string; source_url: string; fetched_at: number; }

// Merge editable fields onto the latest stored record. An open editor must not
// overwrite price observations arriving from another tab or a sync response.
export function mergeWishlistEdits(current: WishlistItem, edited: WishlistItem): WishlistItem {
  const purchaseUrl = normalizeListingUrl(edited.purchaseUrl);
  const sources = [...current.sources];
  if (!sources.some((source) => source.url === purchaseUrl)) {
    if (sources.length >= MAX_WISHLIST_SOURCES) throw new Error(`A piece can have up to ${MAX_WISHLIST_SOURCES} listing links.`);
    sources.push({ url: purchaseUrl, price: "", currency: "", fetched_at: null, link_broken: false });
  }
  return recomputeWishlistPrice({
    ...current, name: edited.name.trim(), brand: edited.brand, category: edited.category,
    size: edited.size, color: edited.color, description: edited.description,
    imageUrl: edited.imageUrl, imageData: edited.imageData,
    backImageUrl: edited.backImageUrl, backImageData: edited.backImageData,
    sideImageUrl: edited.sideImageUrl, sideImageData: edited.sideImageData,
    purchaseUrl, rating: edited.rating, sources, updatedAt: Date.now(),
  });
}
