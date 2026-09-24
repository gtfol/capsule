import type { Category } from "./types";

export const SHARE_EXPIRIES = ["7d", "30d", "never"] as const;
export type ShareExpiry = (typeof SHARE_EXPIRIES)[number];
export const DEFAULT_SHARE_EXPIRY: ShareExpiry = "7d";
export const MAX_SHARE_BODY_BYTES = 3_900_000;
export const MAX_SHARED_PIECES = 300;
export type ShareKind = "wardrobe" | "wishlist" | "piece" | "outfit";

// This explicit snapshot excludes local IDs, account information, original
// model photos, API keys, price history, and other private application state.
export interface SharedPiece {
  sourceKey?: string; // Stable, hashed piece identity; absent on older links.
  name: string;
  brand: string;
  category: Category;
  size: string;
  color: string;
  price: string;
  currency: string;
  description: string;
  purchaseUrl: string;
  imageData: string;
  backImageData?: string;
  sideImageData?: string;
  rating?: number | null;
}

export interface ShareSnapshot {
  version: 1;
  kind: ShareKind;
  title: string;
  ownerName?: string; // Public display name captured when the link is published.
  pieces: SharedPiece[];
  outfitImageData?: string;
}

export interface ShareMetadata {
  id: string;
  expiry: ShareExpiry;
  expiresAt: number | null;
  updatedAt: number;
  /** Deduplicated opens of this link, visible only to its owner. */
  views: number;
}

export interface SharePublicRecord {
  snapshot: ShareSnapshot;
  expiresAt: number | null;
  updatedAt: number;
}
