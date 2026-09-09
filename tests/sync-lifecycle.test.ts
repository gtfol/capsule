import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { useSyncStore } from "../src/lib/sync";

const browser = new EventTarget();
const page = new EventTarget();
Object.defineProperty(page, "visibilityState", { value: "visible" });
Object.defineProperty(globalThis, "window", { value: browser, configurable: true });
Object.defineProperty(globalThis, "document", { value: page, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test("starting offline retries configuration on reconnect and listeners survive cleanup/remount", async () => {
  const originalFetch = globalThis.fetch;
  const originalRefresh = useSyncStore.getState().refreshSession;
  let checks = 0;
  let sessions = 0;
  globalThis.fetch = async () => {
    checks++;
    if (!navigator.onLine) throw new TypeError("Offline");
    return Response.json({ enabled: false, providers: { google: false, email: false } });
  };
  try {
    await useSyncStore.getState().initialize();
    assert.equal(useSyncStore.getState().status, "offline");
    assert.equal(checks, 1);
    Object.assign(navigator, { onLine: true });
    browser.dispatchEvent(new Event("online"));
    await settle();
    assert.equal(checks, 2);
    assert.equal(useSyncStore.getState().status, "disabled");

    // Simulate configured auth after the status check, then a React Strict
    // Mode effect cleanup/remount. Session reads stand in for network work.
    useSyncStore.setState({ enabled: true, status: "signed-out", refreshSession: async () => { sessions++; } });
    useSyncStore.getState().stop();
    await useSyncStore.getState().initialize();
    await settle();
    const afterRemount = sessions;
    browser.dispatchEvent(new Event("online"));
    await settle();
    assert.ok(afterRemount > 0);
    assert.equal(sessions, afterRemount + 1);
  } finally {
    useSyncStore.getState().stop();
    globalThis.fetch = originalFetch;
    useSyncStore.setState({ refreshSession: originalRefresh });
  }
});
