import type { Snapshot } from "./db";
import type { Collection, Item, WardrobeRecord, WishlistItem } from "./types";

function piece(item: Item) {
  return {
    id: item.id, name: item.name, brand: item.brand, size: item.size, color: item.color,
    category: item.category, price: item.price, currency: item.currency, description: item.description,
    purchaseUrl: item.purchaseUrl, imageUrl: item.imageUrl, imageData: item.imageData ?? "",
    backImageUrl: item.backImageUrl ?? "", backImageData: item.backImageData ?? "",
    sideImageUrl: item.sideImageUrl ?? "", sideImageData: item.sideImageData ?? "",
    createdAt: item.createdAt, updatedAt: item.updatedAt,
  };
}
/** Portable personal content only; no account IDs, credentials, or share capabilities. */
export function libraryExport(snapshot: Snapshot, now = new Date()) {
  return {
    format: "capsule", version: 1, exportedAt: now.toISOString(),
    wardrobe: snapshot.items.map(piece),
    wishlist: snapshot.wishlist.map((item) => ({ ...piece(item), rating: item.rating,
      priceHistory: item.priceHistory.map(({ price, currency, source_url, fetched_at }) => ({ price, currency, source_url, fetched_at })),
      sources: item.sources.map(({ url, price, currency, fetched_at, link_broken }) => ({ url, price, currency, fetched_at, link_broken })),
      link_broken: item.link_broken, currentSourceUrl: item.currentSourceUrl,
    })),
    outfits: snapshot.outfits.map(({ id, name, itemIds, imageData, createdAt, updatedAt }) => ({ id, name, itemIds: [...itemIds], imageData, createdAt, updatedAt })),
    modelPhoto: snapshot.referencePhoto,
  };
}
/** Keep only the identity and revision-compatible shape needed to sync a deletion. */
export function libraryTombstone(collection: Collection, record: WardrobeRecord): WardrobeRecord {
  const now = Math.max(Date.now(), record.updatedAt + 1);
  const base = { id: record.id, name: "", createdAt: record.createdAt, updatedAt: now, deletedAt: now };
  if (collection === "outfits") return { ...base, itemIds: [], imageData: "" };
  const item: Item = { ...base, category: "tops", brand: "", size: "", color: "", price: "", currency: "", description: "", purchaseUrl: "", imageUrl: "", imageData: "", backImageUrl: "", backImageData: "", sideImageUrl: "", sideImageData: "" };
  return collection === "wishlist" ? { ...item, rating: null, sources: [], priceHistory: [], link_broken: false, currentSourceUrl: "" } satisfies WishlistItem : item;
}

export function supportUrl(value: string | undefined): string | null {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && url.hostname === "buy.stripe.com" && !url.username && !url.password ? url.href : null; } catch { return null; }
}
