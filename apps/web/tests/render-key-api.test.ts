import assert from "node:assert/strict";
import test from "node:test";
import { createRenderKeyHandlers, resolveRenderCredential, type RenderKeyDependencies } from "../src/lib/server/render-key-api";
import { RenderKeyError } from "../src/lib/server/render-key-storage";
import { renderCredentialPayload } from "../src/lib/render-credential";

const fakeKey = "sk-unit-test-not-a-real-api-key-123456";
const origin = "https://capsule.example";
const request = (method = "PUT", body: unknown = { expectedUserId: "alice", apiKey: fakeKey }, headers: Record<string, string> = {}) => new Request(`${origin}/api/render/key`, { method, headers: { origin, "content-type": "application/json", ...headers }, ...(method !== "GET" ? { body: JSON.stringify(body) } : {}) });
function setup(userId: string | null = "alice") {
  const records = new Map<string, string>();
  const calls: string[] = [];
  const deps: RenderKeyDependencies = {
    userId: async () => userId, configured: () => true,
    store: {
      has: async (id) => { calls.push(`has:${id}`); return records.has(id); },
      save: async (id, key) => { calls.push(`save:${id}`); records.set(id, key); },
      remove: async (id) => { calls.push(`remove:${id}`); records.delete(id); },
      load: async (id) => { calls.push(`load:${id}`); return records.get(id) ?? null; },
    },
  };
  return { deps, records, calls, handlers: createRenderKeyHandlers(deps) };
}

test("guests have no key saving or saved-key access and never touch account storage", async () => {
  const { deps, handlers, calls } = setup(null);
  const status = await handlers.GET(request("GET"));
  assert.deepEqual(await status.json(), { available: false, saved: false, userId: null });
  for (const remove of [false, true]) assert.equal((await handlers.mutate(request(), remove)).status, 401);
  await assert.rejects(resolveRenderCredential({ useSavedKey: true, expectedUserId: "alice" }, request(), deps), (e) => e instanceof RenderKeyError && e.status === 401);
  const session = { apiKey: fakeKey };
  assert.deepEqual(await resolveRenderCredential(session, request(), deps), session);
  assert.deepEqual(calls, []);
});

test("account saves and status return metadata only, while deletion is owner scoped", async () => {
  const { handlers, records } = setup();
  records.set("bob", "another-fake-key");
  const save = await handlers.mutate(request(), false);
  assert.equal(save.status, 200);
  assert.equal(save.headers.get("cache-control"), "no-store");
  assert.deepEqual(await save.json(), { available: true, saved: true, userId: "alice" });
  const status = await handlers.GET(request("GET"));
  assert.deepEqual(await status.json(), { available: true, saved: true, userId: "alice" });
  assert.equal((await handlers.mutate(request("DELETE", { expectedUserId: "alice" }), true)).status, 200);
  assert.ok(!records.has("alice")); assert.ok(records.has("bob"));
});

test("cross-origin, missing-origin, and account-switch requests cannot save, delete, or use keys", async () => {
  const { handlers, deps, calls } = setup();
  for (const headers of [{ origin: "https://elsewhere.example" }, { origin: "" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) {
    for (const remove of [false, true]) assert.equal((await handlers.mutate(request("PUT", undefined, headers), remove)).status, 403);
    await assert.rejects(resolveRenderCredential({ useSavedKey: true, expectedUserId: "alice" }, request("POST", undefined, headers), deps), (e) => e instanceof RenderKeyError && e.status === 403);
  }
  for (const remove of [false, true]) assert.equal((await handlers.mutate(request("PUT", { expectedUserId: "bob", apiKey: fakeKey }), remove)).status, 409);
  assert.equal((await handlers.GET(new Request(`${origin}/api/render/key?expectedUserId=bob`))).status, 409);
  await assert.rejects(resolveRenderCredential({ useSavedKey: true, expectedUserId: "bob" }, request(), deps), (e) => e instanceof RenderKeyError && e.status === 409);
  assert.deepEqual(calls, []);
});

test("saved renders retrieve only the authenticated owner's key and reject ambiguous sources", async () => {
  const { deps, records, calls } = setup();
  records.set("alice", fakeKey);
  const body = { useSavedKey: true, expectedUserId: "alice", items: ["fixture"] };
  assert.deepEqual(await resolveRenderCredential(body, request(), deps), { ...body, apiKey: fakeKey });
  assert.deepEqual(calls, ["load:alice"]);
  await assert.rejects(resolveRenderCredential({ ...body, apiKey: "injected-key" }, request(), deps), /either/);
  for (const value of [false, "true", null]) await assert.rejects(resolveRenderCredential({ ...body, useSavedKey: value }, request(), deps), /valid rendering key source/);
  records.clear();
  await assert.rejects(resolveRenderCredential(body, request(), deps), /Save an OpenAI API key/);
});

test("configuration errors and provider/database failures never echo secrets", async () => {
  const { deps, handlers, records } = setup();
  deps.configured = () => false;
  assert.equal((await handlers.mutate(request(), false)).status, 503);
  assert.deepEqual(await (await handlers.GET(request("GET"))).json(), { available: false, saved: false, userId: "alice" });
  records.set("alice", fakeKey);
  assert.equal((await handlers.mutate(request("DELETE", { expectedUserId: "alice" }), true)).status, 200);
  deps.configured = () => true;
  deps.store.has = deps.store.save = deps.store.remove = deps.store.load = async () => { throw new Error(fakeKey); };
  for (const response of [await handlers.GET(request("GET")), await handlers.mutate(request(), false), await handlers.mutate(request(), true)]) {
    assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store"); assert.ok(!(await response.text()).includes(fakeKey));
  }
});

test("key writes reject malformed and oversized bodies before writing", async () => {
  const { handlers, calls } = setup();
  for (const body of [null, [], {}, { expectedUserId: "alice", apiKey: "invalid" }]) assert.ok((await handlers.mutate(request("PUT", body), false)).status >= 400);
  assert.equal((await handlers.mutate(request("PUT", {}, { "content-type": "text/plain" }), false)).status, 415);
  assert.equal((await handlers.mutate(request("PUT", { data: "x".repeat(3000) }), false)).status, 413);
  assert.deepEqual(calls, []);
});

test("client rendering credentials cannot cross guest/account boundaries or contain an account secret", () => {
  assert.deepEqual(renderCredentialPayload({ type: "session", apiKey: fakeKey }, "guest"), { apiKey: fakeKey });
  assert.deepEqual(renderCredentialPayload({ type: "saved", userId: "alice" }, "account:alice"), { useSavedKey: true, expectedUserId: "alice" });
  assert.throws(() => renderCredentialPayload({ type: "saved", userId: "alice" }, "guest"));
  assert.throws(() => renderCredentialPayload({ type: "saved", userId: "alice" }, "account:bob"));
  assert.throws(() => renderCredentialPayload({ type: "session", apiKey: fakeKey }, "account:alice"));
});
