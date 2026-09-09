import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { accountSpace, GUEST_SPACE, readSnapshot } from "../src/lib/db";
import { useWardrobe } from "../src/lib/store";

Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
Object.defineProperty(globalThis, "document", { value: Object.assign(new EventTarget(), { visibilityState: "visible" }), configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("late session reads cannot undo sign-out and a new account syncs after an older request", async () => {
  const originalFetch = globalThis.fetch;
  let handleFetch: typeof fetch = originalFetch;
  globalThis.fetch = (input, init) => handleFetch(input, init);
  // Better Auth captures fetch when its client is created.
  const { useSyncStore } = await import("../src/lib/sync");
  const first = { id: crypto.randomUUID(), email: "first@example.com", name: "First" };
  const second = { id: crypto.randomUUID(), email: "second@example.com", name: "Second" };
  const startedSession = deferred<void>();
  const delayedSession = deferred<Response>();
  try {
    await useWardrobe.getState().initialize();
    await useWardrobe.getState().switchSpace(accountSpace(first.id));
    useSyncStore.setState({ enabled: true, user: first, status: "idle" });
    handleFetch = async (input) => {
      const path = String(input);
      if (path.includes("get-session")) { startedSession.resolve(); return delayedSession.promise; }
      if (path.includes("sign-out")) return Response.json({ success: true });
      throw new Error(`Unexpected request: ${path}`);
    };
    const refresh = useSyncStore.getState().refreshSession();
    await startedSession.promise;
    await useSyncStore.getState().signOut();
    delayedSession.resolve(Response.json({ user: first, session: { id: "old-session" } }));
    await refresh;
    assert.equal(useSyncStore.getState().user, null);
    assert.equal(useWardrobe.getState().space, GUEST_SPACE);
    assert.equal(useSyncStore.getState().status, "signed-out");

    const startedSync = deferred<void>();
    const delayedSync = deferred<Response>();
    const accounts: string[] = [];
    handleFetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      accounts.push(request.expectedUserId);
      if (request.expectedUserId === first.id) { startedSync.resolve(); return delayedSync.promise; }
      return Response.json({ userId: second.id, results: [], rows: [], cursor: 0, hasMore: false });
    };
    useSyncStore.setState({ user: first, status: "idle" });
    await useWardrobe.getState().switchSpace(accountSpace(first.id));
    const oldSync = useSyncStore.getState().syncNow();
    await startedSync.promise;
    useSyncStore.setState({ user: second, status: "idle" });
    await useWardrobe.getState().switchSpace(accountSpace(second.id));
    const newSync = useSyncStore.getState().syncNow();
    delayedSync.resolve(Response.json({ userId: first.id, results: [], rows: [], cursor: 0, hasMore: false }));
    await Promise.all([oldSync, newSync]);
    assert.deepEqual(accounts, [first.id, second.id]);
    assert.equal(useSyncStore.getState().user?.id, second.id);
    assert.equal(useWardrobe.getState().space, accountSpace(second.id));
    assert.deepEqual((await readSnapshot(accountSpace(second.id))).items, []);
    handleFetch = async (input) => String(input).includes("get-session")
      ? Response.json({ user: { ...second, name: "Updated display name" }, session: { id: "current-session" } })
      : Response.json({ userId: second.id, results: [], rows: [], cursor: 0, hasMore: false });
    await useSyncStore.getState().refreshSession();
    assert.equal(useSyncStore.getState().user?.name, "Updated display name");
  } finally {
    useSyncStore.getState().stop();
    globalThis.fetch = originalFetch;
  }
});
