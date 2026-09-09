export const CATEGORIES = ["tops", "jackets", "bottoms", "accessories", "shoes"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Item {
  id: string;
  name: string;
  brand: string;
  size: string;
  color: string;
  category: Category;
  price: string;
  currency: string;
  description: string;
  purchaseUrl: string;
  imageUrl: string;
  imageData?: string;
  backImageUrl?: string;
  backImageData?: string;
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

export type Collection = "items" | "outfits";
export type WardrobeRecord = Item | Outfit;
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
export interface SyncUser { id: string; email: string; }
export interface SyncProviders { google: boolean; email: boolean; }
