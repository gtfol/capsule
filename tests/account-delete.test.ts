import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { createAccountDeleteHandler } from "../src/lib/server/account-api";
import { activateSpace, applySyncResponse, forgetDeletedAccount, listStored, readLibrarySnapshot, writeRecord, writeReferencePhoto } from "../src/lib/db";
import type { Item } from "../src/lib/types";
Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });
const origin = "https://capsule.test";
function req(body: unknown, headers: Record<string, string> = {}) { return new Request(`${origin}/api/account`, { method: "DELETE", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); }
test("account deletion authenticates, checks origin/account/confirmation, and passes only hashed share tokens to storage", async () => {
  let calls = 0;
  const handler = createAccountDeleteHandler({ userId: async () => "owner", remove: async (id, links) => { calls++; assert.equal(id, "owner"); assert.match(links[0].hash, /^[a-f0-9]{64}$/); assert.equal('token' in links[0], false); } });
  const body = { expectedUserId: "owner", confirmation: "DELETE", links: [{ id: Buffer.alloc(16, 1).toString("base64url"), token: Buffer.alloc(32, 1).toString("base64url") }] };
  for (const headers of [{ origin: "https://evil.test" }, { origin: "" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) assert.equal((await handler(req(body, headers))).status, 403);
  assert.equal((await handler(req({ ...body, expectedUserId: "other" }))).status, 409);
  assert.equal((await handler(req({ ...body, confirmation: "yes" }))).status, 400);
  assert.equal((await handler(req({ ...body, links: [{ id: "bad", token: "bad" }] }))).status, 400);
  assert.equal(calls, 0);
  const result = await handler(req(body)); assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "no-store"); assert.equal(calls, 1);
  const guest = createAccountDeleteHandler({ userId: async () => null, remove: async () => { throw new Error("must not execute"); } });
  assert.equal((await guest(req(body))).status, 401);
  const failure = createAccountDeleteHandler({ userId: async () => "owner", remove: async () => { throw new Error("database-secret"); } });
  const error = await failure(req(body)); assert.equal(error.status, 503); assert.doesNotMatch(await error.text(), /database-secret/);
});
test("deleted account caches reject late sync responses and writes while preserving other spaces", async () => {
  const userId = crypto.randomUUID(), space = `account:${userId}`, other = `account:${crypto.randomUUID()}`;
  const item: Item = { id: crypto.randomUUID(), name: "Private", category: "tops", brand: "", size: "", color: "", price: "", currency: "", description: "", purchaseUrl: "", imageUrl: "", createdAt: 1, updatedAt: 1 };
  await activateSpace(space); await writeRecord(space, "items", item); await writeRecord(other, "items", item); await writeReferencePhoto(space, "photo");
  await forgetDeletedAccount(space);
  assert.equal((await listStored(space)).length, 0); assert.equal((await listStored(other)).length, 1);
  assert.equal(await applySyncResponse(space, [], { userId, results: [], rows: [{ collection: "items", record: item, revision: 2 }], cursor: 2, hasMore: false }), 0);
  await assert.rejects(writeRecord(space, "items", item), /deleted/);
  await assert.rejects(writeReferencePhoto(space, "late photo"), /deleted/);
  assert.equal((await listStored(space)).length, 0);
  assert.ok(await readLibrarySnapshot("guest", () => {}));
});
