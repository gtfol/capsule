"use client";

import { accountSpace, importSharedRecords } from "./db";
import { cacheProductImages } from "./images";
import { useSyncStore } from "./sync";
import { useWardrobe } from "./store";
import { createWishlistItem, wishlistPriceNumber } from "./wishlist";
import type { Item, WishlistItem } from "./types";
import type { SharedPiece, ShareSnapshot } from "./share-types";

export type SharedCopyDestination = "wardrobe" | "wishlist";
export type SharedCopySelection = "all" | number;
export type SharedCopyIntent = { destination: SharedCopyDestination; selection: SharedCopySelection };

export function readSharedCopyIntent(url: string, pieceCount: number): SharedCopyIntent | null {
  try {
    const parsed = new URL(url);
    const destination = parsed.searchParams.get("addTo");
    const value = parsed.searchParams.get("piece");
    if (destination !== "wardrobe" && destination !== "wishlist") return null;
    if (value === "all" && pieceCount > 0) return { destination, selection: "all" };
    if (value !== null && /^(0|[1-9]\d*)$/.test(value)) {
      const selection = Number(value);
      if (Number.isSafeInteger(selection) && selection < pieceCount) return { destination, selection };
    }
    return null;
  } catch { return null; }
}

export function sharedCopyReturnUrl(url: string, intent: SharedCopyIntent): string {
  const parsed = new URL(url);
  parsed.searchParams.set("addTo", intent.destination);
  parsed.searchParams.set("piece", String(intent.selection));
  return parsed.href;
}

export function selectedSharedPieces(snapshot: ShareSnapshot, selection: SharedCopySelection): SharedPiece[] {
  if (selection === "all") {
    if (!snapshot.pieces.length) throw new Error("There are no shared pieces to add.");
    return snapshot.pieces;
  }
  if (!Number.isSafeInteger(selection) || selection < 0 || selection >= snapshot.pieces.length) throw new Error("This shared piece is unavailable. Refresh the page.");
  return [snapshot.pieces[selection]];
}

function pieceContent(piece: SharedPiece) {
  // Fixed field order makes equality and duplicate receipts independent of
  // JSON property order. No ownership identifiers or outfit portrait enter it.
  return [piece.name, piece.brand, piece.category, piece.size, piece.color, piece.price, piece.currency, piece.description, piece.purchaseUrl, piece.imageData, piece.backImageData ?? "", piece.sideImageData ?? "", piece.rating ?? null];
}

export function sharedSelectionMatches(shown: ShareSnapshot, current: ShareSnapshot, selection: SharedCopySelection): boolean {
  try { return JSON.stringify(selectedSharedPieces(shown, selection).map(pieceContent)) === JSON.stringify(selectedSharedPieces(current, selection).map(pieceContent)); }
  catch { return false; }
}

export async function sharedCopyReceipt(shareId: string, destination: SharedCopyDestination, pieces: SharedPiece[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([shareId, destination, pieces.map(pieceContent)]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `shared-copy:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function wishlistCopyPrice(price: string, currency: string): { price: string; currency: string } {
  const normalizedCurrency = currency.trim().toUpperCase();
  const validCurrency = /^[A-Z]{3}$/.test(normalizedCurrency);
  let value = price.trim().replace(/^[$€£¥]\s*/, "");
  if (validCurrency) value = value.replace(new RegExp(`^${normalizedCurrency}\\s*|\\s*${normalizedCurrency}$`, "gi"), "");
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(value)) value = value.replaceAll(",", "");
  const amount = wishlistPriceNumber(value);
  return { price: amount === null ? "" : String(amount), currency: validCurrency ? normalizedCurrency : "" };
}

export interface SharedCopyDependencies {
  refreshSession: () => Promise<void>;
  context: () => { userId: string | null; space: string };
  fetchSnapshot: (shareId: string, expectedUserId: string) => Promise<{ snapshot: ShareSnapshot; userId: string }>;
  cacheImages: (piece: SharedPiece) => Promise<{ imageData: string; backImageData?: string; sideImageData?: string }>;
  persist: (space: string, collection: "items" | "wishlist", records: Array<Item | WishlistItem>, receipt: string, guard: () => void) => Promise<{ count: number; alreadyAdded: boolean }>;
  uuid: () => string;
  now: () => number;
}

const dependencies: SharedCopyDependencies = {
  refreshSession: () => useSyncStore.getState().refreshSession(),
  context: () => ({ userId: useSyncStore.getState().user?.id ?? null, space: useWardrobe.getState().space }),
  fetchSnapshot: async (shareId, expectedUserId) => {
    const response = await fetch(`/api/share/${encodeURIComponent(shareId)}/copy`, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ expectedUserId }), signal: AbortSignal.timeout(20_000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "These pieces could not be added. Try again.");
    if (data?.userId !== expectedUserId || !data?.snapshot || !Array.isArray(data.snapshot.pieces)) throw new Error("Your account or this share link changed. Refresh the page and try again.");
    return data;
  },
  cacheImages: (piece) => cacheProductImages({ imageUrl: "", imageData: piece.imageData }, piece.backImageData ? { imageUrl: "", imageData: piece.backImageData } : undefined, piece.sideImageData ? { imageUrl: "", imageData: piece.sideImageData } : undefined),
  persist: importSharedRecords,
  uuid: () => crypto.randomUUID(),
  now: () => Date.now(),
};

export async function copySharedPieces(input: { shareId: string; shownSnapshot: ShareSnapshot; selection: SharedCopySelection; destination: SharedCopyDestination; expectedUserId: string }, deps: SharedCopyDependencies = dependencies): Promise<{ count: number; alreadyAdded: boolean }> {
  const space = accountSpace(input.expectedUserId);
  const guard = () => {
    const current = deps.context();
    if (!input.expectedUserId || current.userId !== input.expectedUserId || current.space !== space) throw new Error("Your account changed. Sign in again before adding these pieces.");
  };
  await deps.refreshSession();
  guard();
  const current = await deps.fetchSnapshot(input.shareId, input.expectedUserId);
  guard();
  if (current.userId !== input.expectedUserId) throw new Error("Your account changed. Sign in again before adding these pieces.");
  if (!sharedSelectionMatches(input.shownSnapshot, current.snapshot, input.selection)) throw new Error("This shared collection has changed. Refresh the page to review it before adding pieces.");
  const pieces = selectedSharedPieces(current.snapshot, input.selection);
  const receipt = await sharedCopyReceipt(input.shareId, input.destination, pieces);
  const records: Array<Item | WishlistItem> = [];
  for (const piece of pieces) {
    guard();
    const images = await deps.cacheImages(piece);
    guard();
    const now = deps.now();
    const item: Item = {
      id: deps.uuid(), name: piece.name, brand: piece.brand, category: piece.category,
      size: piece.size, color: piece.color, price: piece.price, currency: piece.currency,
      description: piece.description, purchaseUrl: piece.purchaseUrl, imageUrl: "", ...images,
      createdAt: now, updatedAt: now, deletedAt: null,
    };
    records.push(input.destination === "wishlist" ? createWishlistItem({ ...item, ...wishlistCopyPrice(item.price, item.currency) }, now, null) : item);
  }
  guard();
  return deps.persist(space, input.destination === "wishlist" ? "wishlist" : "items", records, receipt, guard);
}
