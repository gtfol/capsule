export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export const THEME_STORAGE_KEY = "capsule-theme";

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === "system" ? systemDark ? "dark" : "light" : preference;
}

// This script contains only static application code, so it can run before React hydrates.
export const THEME_BOOTSTRAP_SCRIPT = `(()=>{let p="system";try{const v=localStorage.getItem("capsule-theme");if(v==="light"||v==="dark")p=v}catch{}let d=false;try{d=matchMedia("(prefers-color-scheme: dark)").matches}catch{}const t=p==="system"?(d?"dark":"light"):p;document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;const m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="dark"?"#000000":"#ffffff")})();`;

export interface ThemeEnvironment {
  readPreference(): string | null;
  writePreference(preference: ThemePreference): void;
  systemDark(): boolean;
  onSystemChange(listener: () => void): () => void;
  onStorageChange(listener: (value: string | null) => void): () => void;
  apply(theme: ResolvedTheme): void;
}

// The environment boundary keeps blocked storage and browser events independently testable.
export function createThemeStore(environment: ThemeEnvironment) {
  let preference: ThemePreference = "system";
  let resolved: ResolvedTheme = "light";
  let disconnect: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const apply = () => {
    let systemDark = false;
    try { systemDark = environment.systemDark(); } catch {}
    const next = resolveTheme(preference, systemDark);
    const changed = resolved !== next;
    resolved = next;
    environment.apply(next);
    return changed;
  };
  const update = (next: ThemePreference) => {
    const changed = preference !== next;
    preference = next;
    const appearanceChanged = apply();
    if (changed || appearanceChanged) notify();
  };
  const connect = () => {
    if (disconnect) return;
    // If storage is blocked, retain any choice already made in this tab.
    try { preference = parseThemePreference(environment.readPreference()); } catch {}
    const stopSystem = environment.onSystemChange(() => { if (preference === "system" && apply()) notify(); });
    const stopStorage = environment.onStorageChange((value) => update(parseThemePreference(value)));
    disconnect = () => { stopSystem(); stopStorage(); disconnect = undefined; };
    apply();
  };
  return {
    getSnapshot: () => preference,
    getResolvedSnapshot: () => resolved,
    subscribe(listener: () => void) {
      connect();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) disconnect?.();
      };
    },
    setPreference(next: ThemePreference) {
      const value = parseThemePreference(next);
      try { environment.writePreference(value); } catch {}
      update(value);
    },
  };
}

let browserStore: ReturnType<typeof createThemeStore> | undefined;
function getBrowserStore() {
  if (browserStore) return browserStore;
  let media: MediaQueryList | undefined;
  try { media = window.matchMedia("(prefers-color-scheme: dark)"); } catch {}
  browserStore = createThemeStore({
    readPreference: () => window.localStorage.getItem(THEME_STORAGE_KEY),
    writePreference: (preference) => window.localStorage.setItem(THEME_STORAGE_KEY, preference),
    systemDark: () => media?.matches ?? false,
    onSystemChange(listener) {
      if (!media) return () => {};
      if (typeof media.addEventListener === "function") {
        media.addEventListener("change", listener);
        return () => media.removeEventListener("change", listener);
      }
      media.addListener(listener);
      return () => media.removeListener(listener);
    },
    onStorageChange(listener) {
      const changed = (event: StorageEvent) => {
        if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
        try { if (event.storageArea !== window.localStorage) return; } catch { return; }
        listener(event.newValue);
      };
      window.addEventListener("storage", changed);
      return () => window.removeEventListener("storage", changed);
    },
    apply(theme) {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#000000" : "#ffffff");
    },
  });
  return browserStore;
}

export function subscribeTheme(listener: () => void) { return getBrowserStore().subscribe(listener); }
export function getThemePreference(): ThemePreference { return browserStore?.getSnapshot() ?? "system"; }
export function getServerThemePreference(): ThemePreference { return "system"; }
export function getResolvedTheme(): ResolvedTheme { return browserStore?.getResolvedSnapshot() ?? "light"; }
export function getServerResolvedTheme(): ResolvedTheme { return "light"; }
export function setThemePreference(preference: ThemePreference) { getBrowserStore().setPreference(preference); }
