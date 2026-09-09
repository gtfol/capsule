"use client";

import { create } from "zustand";
import { activateSpace, currentSpace, GUEST_SPACE, readSnapshot, removeRecord, subscribeToLocalChanges, writeRecord, writeReferencePhoto } from "./db";
import type { Item, Outfit } from "./types";

interface WardrobeState {
  items: Item[];
  outfits: Outfit[];
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
    items: [], outfits: [], referencePhoto: null, ready: false, error: null, space: GUEST_SPACE,
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
      set({ space, items: [], outfits: [], referencePhoto: null, ready: false, error: null });
      await activateSpace(space);
      await get().reload();
    },
    saveItem: (item) => change((space) => writeRecord(space, "items", item)),
    deleteItem: (id) => change((space) => removeRecord(space, "items", id)),
    saveOutfit: (outfit) => change((space) => writeRecord(space, "outfits", outfit)),
    deleteOutfit: (id) => change((space) => removeRecord(space, "outfits", id)),
    setReferencePhoto: (data) => change((space) => writeReferencePhoto(space, data)),
  };
});
