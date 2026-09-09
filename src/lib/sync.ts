"use client";

import { create } from "zustand";
import { authClient } from "./auth-client";
import { accountSpace, applySyncResponse, GUEST_SPACE, importGuestOnce, pendingChanges, subscribeToLocalChanges, syncCursor } from "./db";
import { useWardrobe } from "./store";
import type { SyncChange, SyncProviders, SyncResponse, SyncUser } from "./types";

export type SyncStatus = "loading" | "disabled" | "signed-out" | "idle" | "syncing" | "offline" | "error";
interface SyncState {
  enabled: boolean;
  providers: SyncProviders;
  status: SyncStatus;
  user: SyncUser | null;
  error: string | null;
  lastSyncAt: number | null;
  initialize: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => void;
  refreshSession: () => Promise<void>;
  syncNow: () => Promise<void>;
  signOut: () => Promise<void>;
}
let initialized: Promise<void> | null = null;
let running: Promise<void> | null = null;
let runningAccountId: string | null = null;
let refreshRunning: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let cleanup: (() => void) | null = null;
let sessionGeneration = 0;
let applyingRemote = false;
const encoder = new TextEncoder();
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Sync could not finish. Your changes are saved in this browser.";

export function selectSyncBatch(changes: SyncChange[]): SyncChange[] {
  const selected: SyncChange[] = [];
  let bytes = 1_000;
  for (const change of changes) {
    const size = encoder.encode(JSON.stringify(change)).length + 1;
    if (size > 3_500_000) throw new Error("An image is too large to sync. Save a smaller image and try again.");
    if (selected.length >= 30 || bytes + size > 3_500_000) break;
    bytes += size;
    selected.push(change);
  }
  return selected;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  enabled: false,
  providers: { google: false, email: false },
  status: "loading",
  user: null,
  error: null,
  lastSyncAt: null,
  initialize: () => {
    // Attach recovery listeners even when the first status request happens
    // offline. Also reattach after a Strict Mode effect cleanup/remount.
    void get().start();
    if (initialized) return initialized;
    initialized = (async () => {
      await useWardrobe.getState().initialize();
      try {
        const response = await fetch("/api/sync/status", { cache: "no-store" });
        if (!response.ok) throw new Error("Unable to check sync availability.");
        const data = await response.json();
        const enabled = data.enabled === true;
        set({ enabled, providers: { google: enabled && data.providers?.google === true, email: enabled && data.providers?.email === true }, status: enabled ? "signed-out" : "disabled" });
        if (enabled) await get().refreshSession();
      } catch {
        set({ status: navigator.onLine ? "error" : "offline", error: "Sync is unavailable. Your wardrobe is saved in this browser." });
        initialized = null;
      }
    })();
    return initialized;
  },
  start: async () => {
    if (!cleanup) {
      const refresh = () => {
        if (document.visibilityState === "visible") {
          if (get().enabled) void get().refreshSession();
          else if (get().status !== "disabled") void get().initialize();
        }
      };
      const online = () => {
        if (get().enabled) void get().refreshSession();
        else void get().initialize();
      };
      const offline = () => { if (get().user) set({ status: "offline" }); };
      window.addEventListener("online", online);
      window.addEventListener("offline", offline);
      document.addEventListener("visibilitychange", refresh);
      const unsubscribe = subscribeToLocalChanges((space, source) => {
        if (source === "remote" || applyingRemote || !get().user || space !== accountSpace(get().user!.id)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { void get().syncNow(); }, 1_500);
      });
      interval = setInterval(() => {
        refresh();
      }, 60_000);
      cleanup = () => {
        unsubscribe();
        window.removeEventListener("online", online);
        window.removeEventListener("offline", offline);
        document.removeEventListener("visibilitychange", refresh);
      };
    }
    await get().refreshSession();
  },
  stop: () => {
    cleanup?.(); cleanup = null;
    if (timer) clearTimeout(timer);
    if (interval) clearInterval(interval);
    timer = null; interval = null;
  },
  refreshSession: () => {
    if (refreshRunning) return refreshRunning;
    let refreshGeneration = sessionGeneration;
    refreshRunning = (async () => {
      if (!get().enabled) return;
      if (!navigator.onLine) { set({ status: "offline" }); return; }
      try {
        const { data, error } = await authClient.getSession({ query: { disableCookieCache: true } });
        if (refreshGeneration !== sessionGeneration) return;
        if (error) throw new Error(error.message || "Unable to check your sync session.");
        if (data?.user) {
          const user = { id: data.user.id, email: data.user.email };
          if (get().user?.id !== user.id) sessionGeneration++;
          refreshGeneration = sessionGeneration;
          await importGuestOnce(user.id);
          if (refreshGeneration !== sessionGeneration) return;
          const space = accountSpace(user.id);
          if (useWardrobe.getState().space !== space) await useWardrobe.getState().switchSpace(space);
          if (refreshGeneration !== sessionGeneration) return;
          set({ user, status: "idle", error: null });
          await get().syncNow();
        } else {
          sessionGeneration++;
          set({ user: null, status: "signed-out", lastSyncAt: null, error: null });
          // An expired session leaves this device's account space intact and
          // usable offline. Explicit sign-out switches to the guest space.
        }
      } catch (error) {
        if (refreshGeneration === sessionGeneration) set({ status: navigator.onLine ? "error" : "offline", error: errorMessage(error) });
      }
    })().finally(() => { refreshRunning = null; });
    return refreshRunning;
  },
  syncNow: () => {
    if (running) {
      const finishingAccount = runningAccountId;
      return running.then(() => {
        if (get().user && get().user?.id !== finishingAccount) return get().syncNow();
      });
    }
    const user = get().user;
    if (!user || !get().enabled) return Promise.resolve();
    if (!navigator.onLine) { set({ status: "offline" }); return Promise.resolve(); }
    const generation = sessionGeneration;
    const space = accountSpace(user.id);
    runningAccountId = user.id;
    running = (async () => {
      set({ status: "syncing", error: null });
      let conflicts = 0;
      try {
        // A browser lock keeps tabs from racing the same cursor; server CAS
        // and local token checks also protect browsers without Web Locks.
        const exchange = async () => {
          for (let round = 0; round < 100; round++) {
            if (generation !== sessionGeneration || get().user?.id !== user.id) return;
            const changes = selectSyncBatch(await pendingChanges(space));
            const cursor = await syncCursor(space);
            const response = await fetch("/api/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ expectedUserId: user.id, cursor, changes }),
            });
            if (response.status === 401 || response.status === 409) {
              if (generation === sessionGeneration) {
                sessionGeneration++;
                set({ user: null, status: "signed-out", error: "Sign in again to continue syncing." });
              }
              return;
            }
            if (!response.ok) {
              const problem = await response.json().catch(() => null);
              throw new Error(problem?.error || `Sync could not finish (${response.status}).`);
            }
            const data = await response.json() as SyncResponse;
            if (data.userId !== user.id) throw new Error("The sync account changed. Sign in again.");
            // This applies to the captured account only, never the account
            // currently shown if a sign-out occurred while fetching.
            applyingRemote = true;
            try { conflicts += await applySyncResponse(space, changes, data); }
            finally { applyingRemote = false; }
            if (!data.hasMore && (await pendingChanges(space)).length === 0) break;
            if (round === 99) throw new Error("Some changes are still waiting. Sync again to continue.");
          }
        };
        if (navigator.locks) await navigator.locks.request(`capsule-sync:${space}`, exchange);
        else await exchange();
        if (generation === sessionGeneration && get().user?.id === user.id) {
          set({ status: "idle", lastSyncAt: Date.now(), error: conflicts ? "Changes made on two devices were kept as separate copies. A deletion that conflicted with an edit kept the edited item." : null });
        }
      } catch (error) {
        if (generation === sessionGeneration) set({ status: navigator.onLine ? "error" : "offline", error: errorMessage(error) });
      }
    })().finally(() => { running = null; runningAccountId = null; });
    return running;
  },
  signOut: async () => {
    try {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message || "Unable to sign out.");
      sessionGeneration++;
      set({ user: null, status: "signed-out", lastSyncAt: null, error: null });
      await useWardrobe.getState().switchSpace(GUEST_SPACE);
    } catch (error) {
      set({ error: errorMessage(error), status: "error" });
      throw error;
    }
  },
}));
