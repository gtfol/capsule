export const CATEGORIES = ["tops", "jackets", "bottoms", "accessories", "shoes"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Item {
  id: string;
  sourceKey?: string; // Opaque identity retained when copying a shared piece.
  name: string;
  brand: string;
  size: string;
  color: string;
  category: Category;
  price: string;
  currency: string;
  description: string;
  purchaseUrl: string;
  imageUrl: string; // Empty for a locally uploaded photo; imageData contains its pixels.
  imageData?: string;
  backImageUrl?: string;
  backImageData?: string;
  sideImageUrl?: string;
  sideImageData?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface Outfit {
  id: string;
  name: string;
  itemIds: string[];
  imageData: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface PriceHistoryEntry {
  price: number;
  currency: string;
  source_url: string;
  fetched_at: number;
}

export interface WishlistSource {
  url: string;
  price: string;
  currency: string;
  fetched_at: number | null;
  link_broken: boolean;
}

export interface WishlistItem extends Item {
  rating: number | null;
  priceHistory: PriceHistoryEntry[];
  sources: WishlistSource[];
  link_broken: boolean;
  currentSourceUrl: string;
}

export type Collection = "items" | "outfits" | "wishlist";
export type WardrobeRecord = Item | Outfit | WishlistItem;
export interface SyncChange {
  collection: Collection;
  record: WardrobeRecord;
  baseRevision: number;
  token: string;
}
export interface SyncRow {
  collection: Collection;
  record: WardrobeRecord;
  revision: number;
}
export type SyncOutcome =
  | { id: string; collection: Collection; status: "ok"; revision: number }
  | { id: string; collection: Collection; status: "conflict"; server: SyncRow };
export interface SyncResponse {
  userId: string;
  results: SyncOutcome[];
  rows: SyncRow[];
  cursor: number;
  hasMore: boolean;
}
export interface SyncUser { id: string; email: string; name: string; }
export interface SyncProviders { google: boolean; email: boolean; }
