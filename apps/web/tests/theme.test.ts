import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createThemeStore, THEME_BOOTSTRAP_SCRIPT, type ResolvedTheme, type ThemePreference } from "../src/lib/theme";

function environment(saved: string | null = null, dark = false) {
  let stored = saved;
  let systemDark = dark;
  let blocked = false;
  const applied: ResolvedTheme[] = [];
  const systemListeners = new Set<() => void>();
  const storageListeners = new Set<(value: string | null) => void>();
  const store = createThemeStore({
    readPreference: () => { if (blocked) throw new Error("Storage blocked"); return stored; },
    writePreference: (value) => { if (blocked) throw new Error("Storage blocked"); stored = value; },
    systemDark: () => systemDark,
    onSystemChange: (listener) => { systemListeners.add(listener); return () => { systemListeners.delete(listener); }; },
    onStorageChange: (listener) => { storageListeners.add(listener); return () => { storageListeners.delete(listener); }; },
    apply: (value) => { applied.push(value); },
  });
  return {
    store, applied, systemListeners, storageListeners,
    stored: () => stored,
    blockStorage: () => { blocked = true; },
    changeSystem(value: boolean) { systemDark = value; for (const listener of systemListeners) listener(); },
    changeStorage(value: string | null) { stored = value; for (const listener of storageListeners) listener(value); },
  };
}

test("an unset theme defaults to System and follows the current OS appearance", () => {
  const fixture = environment(null, true);
  const resolvedChanges: ResolvedTheme[] = [];
  const unsubscribe = fixture.store.subscribe(() => { resolvedChanges.push(fixture.store.getResolvedSnapshot()); });
  assert.equal(fixture.store.getSnapshot(), "system");
  assert.equal(fixture.store.getResolvedSnapshot(), "dark");
  assert.equal(fixture.applied.at(-1), "dark");
  fixture.changeSystem(false);
  assert.equal(fixture.applied.at(-1), "light");
  assert.equal(fixture.store.getResolvedSnapshot(), "light");
  assert.deepEqual(resolvedChanges, ["light"]);
  assert.equal(fixture.stored(), null);
  unsubscribe();
});

test("toggling the resolved System appearance persists the opposite explicit theme", () => {
  const fixture = environment(null, true);
  const unsubscribe = fixture.store.subscribe(() => {});
  const opposite = fixture.store.getResolvedSnapshot() === "dark" ? "light" : "dark";
  fixture.store.setPreference(opposite);
  assert.equal(fixture.stored(), "light");
  assert.equal(fixture.store.getResolvedSnapshot(), "light");
  fixture.changeSystem(false);
  fixture.changeSystem(true);
  assert.equal(fixture.store.getResolvedSnapshot(), "light");
  unsubscribe();
});

test("an explicit saved preference ignores OS changes until System is selected", () => {
  const fixture = environment("light", true);
  let notifications = 0;
  const unsubscribe = fixture.store.subscribe(() => { notifications++; });
  assert.equal(fixture.applied.at(-1), "light");
  const initialApplications = fixture.applied.length;
  fixture.changeSystem(false);
  fixture.changeSystem(true);
  assert.equal(fixture.applied.length, initialApplications);
  fixture.store.setPreference("system");
  assert.equal(fixture.stored(), "system");
  assert.equal(fixture.applied.at(-1), "dark");
  assert.equal(notifications, 1);
  fixture.changeSystem(false);
  assert.equal(fixture.applied.at(-1), "light");
  unsubscribe();
});

test("another tab's choices and storage clearing update the active theme", () => {
  const fixture = environment("light", true);
  const observed: ThemePreference[] = [];
  const unsubscribe = fixture.store.subscribe(() => { observed.push(fixture.store.getSnapshot()); });
  fixture.changeStorage("dark");
  assert.equal(fixture.applied.at(-1), "dark");
  fixture.changeStorage("light");
  assert.equal(fixture.applied.at(-1), "light");
  fixture.changeStorage(null);
  assert.equal(fixture.applied.at(-1), "dark");
  assert.deepEqual(observed, ["dark", "light", "system"]);
  unsubscribe();
});

test("blocked storage still permits an in-tab choice and retains it across subscriptions", () => {
  const fixture = environment(null, false);
  fixture.blockStorage();
  const unsubscribe = fixture.store.subscribe(() => {});
  fixture.store.setPreference("dark");
  assert.equal(fixture.applied.at(-1), "dark");
  assert.equal(fixture.store.getSnapshot(), "dark");
  unsubscribe();
  const subscribeAgain = fixture.store.subscribe(() => {});
  assert.equal(fixture.store.getSnapshot(), "dark");
  assert.equal(fixture.applied.at(-1), "dark");
  subscribeAgain();
});

test("invalid stored preferences safely fall back to System", () => {
  const fixture = environment("unexpected", true);
  const unsubscribe = fixture.store.subscribe(() => {});
  assert.equal(fixture.store.getSnapshot(), "system");
  assert.equal(fixture.applied.at(-1), "dark");
  fixture.changeStorage("light");
  fixture.changeStorage("invalid");
  assert.equal(fixture.store.getSnapshot(), "system");
  assert.equal(fixture.applied.at(-1), "dark");
  unsubscribe();
});

test("OS and storage listeners are shared and removed after the final subscriber leaves", () => {
  const fixture = environment();
  const first = fixture.store.subscribe(() => {});
  const second = fixture.store.subscribe(() => {});
  assert.equal(fixture.systemListeners.size, 1);
  assert.equal(fixture.storageListeners.size, 1);
  first();
  assert.equal(fixture.systemListeners.size, 1);
  second();
  assert.equal(fixture.systemListeners.size, 0);
  assert.equal(fixture.storageListeners.size, 0);
  const count = fixture.applied.length;
  fixture.changeSystem(true);
  fixture.changeStorage("dark");
  assert.equal(fixture.applied.length, count);
});

for (const scenario of [
  { saved: "dark", system: false, expected: "dark" },
  { saved: "light", system: true, expected: "light" },
  { saved: "system", system: true, expected: "dark" },
  { saved: null, system: false, expected: "light" },
  { saved: "invalid", system: true, expected: "dark" },
  { saved: null, system: true, blocked: true, expected: "dark" },
] as const) {
  test(`the prepaint script resolves ${scenario.saved ?? "unset"} theme${"blocked" in scenario ? " with blocked storage" : ""}`, () => {
    const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
    const meta = new Map<string, string>();
    runInNewContext(THEME_BOOTSTRAP_SCRIPT, {
      localStorage: { getItem: () => { if ("blocked" in scenario) throw new Error("Blocked"); return scenario.saved; } },
      matchMedia: () => ({ matches: scenario.system }),
      document: { documentElement: root, querySelector: () => ({ setAttribute: (key: string, value: string) => meta.set(key, value) }) },
    });
    assert.equal(root.dataset.theme, scenario.expected);
    assert.equal(root.style.colorScheme, scenario.expected);
    assert.equal(meta.get("content"), scenario.expected === "dark" ? "#000000" : "#ffffff");
  });
}
