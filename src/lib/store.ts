"use client";

import { create } from "zustand";
import { activateSpace, currentSpace, deleteWishlistRecord, GUEST_SPACE, moveWishlistToWardrobe, readSnapshot, removeRecord, subscribeToLocalChanges, updateWishlistRecord, writeRecord, writeReferencePhoto } from "./db";
import type { Item, Outfit, WishlistItem } from "./types";

interface WardrobeState {
  items: Item[];
  outfits: Outfit[];
  wishlist: WishlistItem[];
  referencePhoto: string | null;
  ready: boolean;
  error: string | null;
  space: string;
  initialize: () => Promise<void>;
  reload: () => Promise<void>;
  switchSpace: (space: string) => Promise<void>;
  saveItem: (item: Item) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  saveOutfit: (outfit: Outfit) => Promise<void>;
  deleteOutfit: (id: string) => Promise<void>;
  saveWishlistItem: (item: WishlistItem) => Promise<void>;
  deleteWishlistItem: (id: string, expectedSpace?: string) => Promise<WishlistItem | null>;
  updateWishlistItem: (id: string, transform: (current: WishlistItem) => WishlistItem, expectedSpace?: string) => Promise<WishlistItem | null>;
  moveWishlistToWardrobe: (id: string, expectedSpace?: string, transform?: (current: WishlistItem) => WishlistItem) => Promise<Item | null>;
  setReferencePhoto: (data: string | null) => Promise<void>;
}
let initialization: Promise<void> | null = null;
let revision = 0;
let subscribed = false;
const message = (error: unknown) => error instanceof Error ? error.message : "Unable to save in this browser.";

export const useWardrobe = create<WardrobeState>((set, get) => {
  async function change(action: (space: string) => Promise<void>) {
    if (!get().ready) await get().initialize();
    const space = get().space;
    try {
      await action(space);
      if (get().space === space) await get().reload();
      set({ error: null });
    } catch (error) {
      set({ error: message(error) });
      throw error;
    }
  }
  return {
    items: [], outfits: [], wishlist: [], referencePhoto: null, ready: false, error: null, space: GUEST_SPACE,
    initialize: () => {
      if (initialization) return initialization;
      initialization = (async () => {
        try {
          const space = await currentSpace();
          set({ space });
          if (!subscribed) {
            subscribed = true;
            subscribeToLocalChanges((changedSpace) => {
              if (get().space === changedSpace) void get().reload();
            });
          }
          await get().reload();
        } catch (error) { set({ ready: true, error: message(error) }); }
      })();
      return initialization;
    },
    reload: async () => {
      const space = get().space;
      const token = ++revision;
      try {
        const snapshot = await readSnapshot(space);
        if (space === get().space && token === revision) set({ ...snapshot, ready: true, error: null });
      } catch (error) {
        if (space === get().space && token === revision) set({ ready: true, error: message(error) });
      }
    },
    switchSpace: async (space) => {
      revision++;
      set({ space, items: [], outfits: [], wishlist: [], referencePhoto: null, ready: false, error: null });
      await activateSpace(space);
      await get().reload();
    },
    saveItem: (item) => change((space) => writeRecord(space, "items", item)),
    deleteItem: (id) => change((space) => removeRecord(space, "items", id)),
    saveOutfit: (outfit) => change((space) => writeRecord(space, "outfits", outfit)),
    deleteOutfit: (id) => change((space) => removeRecord(space, "outfits", id)),
    saveWishlistItem: (item) => change((space) => writeRecord(space, "wishlist", item)),
    deleteWishlistItem: async (id, expectedSpace) => {
      if (!get().ready) await get().initialize();
      const space = get().space;
      if (expectedSpace !== undefined && space !== expectedSpace) throw new Error("The active account changed. Reopen this wishlist item to continue.");
      try {
        const removed = await deleteWishlistRecord(space, id, () => {
          if (get().space !== space) throw new Error("The active account changed. Reopen this wishlist item to continue.");
        });
        if (get().space === space) { await get().reload(); set({ error: null }); }
        return removed;
      } catch (error) {
        if (get().space === space) set({ error: message(error) });
        throw error;
      }
    },
    updateWishlistItem: async (id, transform, expectedSpace) => {
      if (!get().ready) await get().initialize();
      const space = get().space;
      if (expectedSpace !== undefined && space !== expectedSpace) throw new Error("The active account changed. Reopen this wishlist item to continue.");
      try {
        const updated = await updateWishlistRecord(space, id, (current) => {
          if (get().space !== space) throw new Error("The active account changed. Reopen this wishlist item to continue.");
          return transform(current);
        });
        if (get().space === space) { await get().reload(); set({ error: null }); }
        return updated;
      } catch (error) {
        if (get().space === space) set({ error: message(error) });
        throw error;
      }
    },
    moveWishlistToWardrobe: async (id, expectedSpace, transform) => {
      if (!get().ready) await get().initialize();
      const space = get().space;
      if (expectedSpace !== undefined && space !== expectedSpace) throw new Error("The active account changed. Reopen this wishlist item to continue.");
      try {
        const owned = await moveWishlistToWardrobe(space, id, (current) => {
          if (get().space !== space) throw new Error("The active account changed. Reopen this wishlist item to continue.");
          return transform ? transform(current) : current;
        });
        if (get().space === space) { await get().reload(); set({ error: null }); }
        return owned;
      } catch (error) {
        if (get().space === space) set({ error: message(error) });
        throw error;
      }
    },
    setReferencePhoto: (data) => change((space) => writeReferencePhoto(space, data)),
  };
});
