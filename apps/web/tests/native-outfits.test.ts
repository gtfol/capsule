import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import sharp from "sharp";
import { createOutfitHandlers, prepareOutfitImage } from "../src/lib/server/outfit-api";
import { MAX_IMAGE_CHARS } from "../src/lib/image-limits";
import { createIntegrationToken, type IntegrationScope } from "../src/lib/server/integration-tokens";
import { RenderError } from "../src/lib/server/render";

const database = process.env.TEST_INTEGRATION_DATABASE_URL;
const scopes: IntegrationScope[] = ["items:read", "outfits:read", "outfits:write", "outfits:delete"];
test("rendered outfit images fit the shared sync record limit", async () => {
  const noisy = await sharp(randomBytes(2200 * 2200 * 3), { raw: { width: 2200, height: 2200, channels: 3 } }).png().toBuffer();
  const image = await prepareOutfitImage(noisy);
  assert.ok(image.length <= MAX_IMAGE_CHARS);
  const metadata = await sharp(Buffer.from(image.split(",")[1], "base64")).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.ok(metadata.width! <= 1500 && metadata.height! <= 1500);
});
test("native outfits: account isolation, concurrent render deduplication, recovery, images and revision-safe edits", { skip: !database }, async () => {
  const url = new URL(database!); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/capsule_integrations_test");
  const pool = new Pool({ connectionString: database }), owner = crypto.randomUUID(), other = crypto.randomUUID();
  const photo = "data:image/jpeg;base64," + (await sharp({ create: { width: 8, height: 12, channels: 3, background: "white" } }).jpeg().toBuffer()).toString("base64");
  const piece = crypto.randomUUID();
  let renders = 0, savedKey: string | null = "sk-" + crypto.randomUUID().replaceAll("-", "");
  let begin!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const api = createOutfitHandlers(pool, {
    render: async () => { renders++; begin(); await wait; return { imageData: photo }; },
    status: () => ({ enabled: true, provider: "openai", model: "test-model", requiresApiKey: true }), keysConfigured: () => true,
    keys: { has: async () => savedKey !== null, load: async () => savedKey, save: async (_id, key) => { savedKey = key; }, remove: async () => { savedKey = null; } },
  });
  try {
    for (const id of [owner, other]) await pool.query('insert into "user"(id,name,email) values($1,$1,$2)', [id, `${id}@example.test`]);
    await pool.query("insert into capsule_records(user_id,collection,id,record) values($1,'items',$2,$3::jsonb)", [owner, piece, JSON.stringify({ id: piece, name: "shirt", deletedAt: null })]);
    const token = await createIntegrationToken(pool, owner, "native", scopes);
    const limited = await createIntegrationToken(pool, owner, "old native", ["items:read", "wishlist:write"]);
    const outsider = await createIntegrationToken(pool, other, "native", scopes);
    const request = (method = "GET", body?: unknown, key = "outfit-render-key", bearer = token.token) => new Request("https://capsule.test/api/v1/outfits", { method, headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", "idempotency-key": key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const input = { name: "weekday", notes: "sleeves rolled", referencePhoto: photo, items: [{ id: piece, name: "shirt", category: "tops", imageData: photo }] };
    assert.equal((await api.list(request("GET", undefined, "unused-key", limited.token))).status, 403);
    assert.equal((await api.render(request("POST", { ...input, apiKey: "not permitted" }))).status, 400);
    const first = api.render(request("POST", input));
    await started;
    assert.equal((await api.render(request("POST", input))).status, 202);
    assert.equal((await api.renderStatus(request(), "outfit-render-key")).status, 202);
    assert.equal((await api.render(request("POST", { ...input, notes: "different" }))).status, 409);
    assert.equal((await api.renderStatus(request("GET", undefined, "unused-key", outsider.token), "outfit-render-key")).status, 404);
    release();
    const response = await first; assert.equal(response.status, 200);
    const receipt = await response.json(); assert.equal(receipt.state, "saved"); assert.equal(renders, 1);
    assert.deepEqual(await (await api.render(request("POST", input))).json(), receipt); assert.equal(renders, 1);
    assert.deepEqual(await (await api.renderStatus(request(), "outfit-render-key")).json(), receipt);
    const list = await (await api.list(request())).json(); assert.equal(list.outfits.length, 1); assert.equal(list.outfits[0].imageData, undefined);
    const item = (await (await api.item(request(), receipt.id)).json()).outfit;
    assert.deepEqual(item.itemIds, [piece]); assert.equal(item.name, "weekday");
    const image = await api.item(request(), receipt.id, true); assert.equal(image.headers.get("content-type"), "image/jpeg");
    assert.ok((await image.arrayBuffer()).byteLength > 20);
    assert.equal((await api.item(request("GET", undefined, "unused-key", outsider.token), receipt.id)).status, 404);
    assert.equal((await api.mutate(request("PATCH", { name: "elsewhere", expectedRevision: receipt.revision + 1 }, "stale-edit"), receipt.id)).status, 409);
    const edit = request("PATCH", { name: "friday", expectedRevision: receipt.revision }, "rename-outfit");
    const changed = await (await api.mutate(edit, receipt.id)).json();
    assert.equal((await api.mutate(request("PATCH", { name: "friday", expectedRevision: receipt.revision }, "rename-outfit"), receipt.id)).status, 200);
    const data = await pool.query("select response::text as value from capsule_integration_receipts where user_id=$1", [owner]);
    assert.ok(data.rows.every(row => !row.value.includes("data:image") && !row.value.includes(savedKey)));
    const configured = await (await api.config(request())).json(); assert.equal(configured.hasSavedKey, true); assert.equal(configured.model, "test-model"); assert.ok(!JSON.stringify(configured).includes(savedKey));
    assert.equal((await api.key(request("PUT", { apiKey: "invalid" }))).status, 400);
    assert.equal((await api.key(request("DELETE", {}))).status, 200); assert.equal(savedKey, null);
    assert.equal((await api.render(request("POST", input, "missing-api-key"))).status, 422);
    const removeBody = { expectedRevision: changed.revision };
    assert.equal((await api.mutate(request("DELETE", removeBody, "delete-outfit"), receipt.id)).status, 200);
    assert.equal((await api.mutate(request("DELETE", removeBody, "delete-outfit"), receipt.id)).status, 200);
    assert.equal((await api.item(request(), receipt.id, true)).status, 404);
    assert.equal((await pool.query("select record->>'imageData' as image from capsule_records where user_id=$1 and id=$2", [owner, receipt.id])).rows[0].image, "");
  } finally { release?.(); await pool.query('delete from "user" where id=any($1)', [[owner, other]]); await pool.end(); }
});

test("native outfits: failed and interrupted renders never repeat provider spending, foreign pieces are rejected", { skip: !database }, async () => {
  const pool = new Pool({ connectionString: database }), owner = crypto.randomUUID();
  let calls = 0;
  const key = "sk-" + crypto.randomUUID().replaceAll("-", "");
  const api = createOutfitHandlers(pool, {
    render: async () => { calls++; throw new RenderError("Your OpenAI API quota was reached.", 429); },
    status: () => ({ enabled: true, provider: "openai", model: "test-model", requiresApiKey: true }), keysConfigured: () => true,
    keys: { has: async () => true, load: async () => key, save: async () => {}, remove: async () => {} },
  });
  try {
    await pool.query('insert into "user"(id,name,email) values($1,$1,$2)', [owner, `${owner}@example.test`]);
    const token = await createIntegrationToken(pool, owner, "native", scopes), piece = crypto.randomUUID();
    const photo = "data:image/jpeg;base64," + (await sharp({ create: { width: 4, height: 4, channels: 3, background: "black" } }).jpeg().toBuffer()).toString("base64");
    const input = { name: "look", referencePhoto: photo, items: [{ id: piece, name: "shirt", category: "tops", imageData: photo }] };
    const req = (body?: unknown, key = "failed-render-key") => new Request("https://capsule.test/api/v1/outfits/render", { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token.token}`, "content-type": "application/json", "idempotency-key": key }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await api.render(req(input))).status, 409); assert.equal(calls, 0);
    await pool.query("insert into capsule_records(user_id,collection,id,record) values($1,'items',$2,$3::jsonb)", [owner, piece, JSON.stringify({ id: piece, deletedAt: null })]);
    assert.equal((await api.render(req(input))).status, 429); assert.equal(calls, 1);
    assert.equal((await api.render(req(input))).status, 422); assert.equal(calls, 1);
    assert.equal((await api.renderStatus(req(), "failed-render-key")).status, 422);
    await pool.query("update capsule_integration_receipts set response=$2::jsonb where user_id=$1", [owner, JSON.stringify({ kind: "outfit-render", state: "pending", startedAt: Date.now() - 181_000 })]);
    const interrupted = await api.renderStatus(req(), "failed-render-key"); assert.equal(interrupted.status, 409); assert.equal((await interrupted.json()).error.code, "RENDER_INTERRUPTED");
    assert.equal((await api.render(req(input))).status, 409); assert.equal(calls, 1);
    await pool.query("update capsule_integration_tokens set revoked_at=now() where id=$1", [token.id]);
    assert.equal((await api.list(req())).status, 401);
  } finally { await pool.query('delete from "user" where id=$1', [owner]); await pool.end(); }
});
