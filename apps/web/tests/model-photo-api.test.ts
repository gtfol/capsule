import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import sharp from "sharp";
import { createModelPhotoHandler, prepareModelPhoto } from "../src/lib/server/model-photo-api";
import { createIntegrationToken } from "../src/lib/server/integration-tokens";
const database = process.env.TEST_INTEGRATION_DATABASE_URL;
const fixture = async (color = "blue") => "data:image/png;base64," + (await sharp({ create: { width: 30, height: 50, channels: 3, background: color } }).png().toBuffer()).toString("base64");
test("model photos normalize bounded rasters and reject remote URLs and invalid data", async () => {
  const data = await prepareModelPhoto(await fixture());
  assert.match(data!, /^data:image\/jpeg;base64,/);
  assert.equal(await prepareModelPhoto(null), null);
  for (const invalid of ["https://example.test/photo.jpg", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/jpeg;base64,eA=="]) await assert.rejects(() => prepareModelPhoto(invalid));
});
test("private model photos share web/native state, protect revisions, remove safely, and cascade on account deletion", { skip: !database }, async () => {
  const url = new URL(database!); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/capsule_integrations_test");
  const pool = new Pool({ connectionString: database }), owner = crypto.randomUUID(), other = crypto.randomUUID();
  let currentUser: string | null = owner;
  const web = createModelPhotoHandler(pool, false, async () => currentUser), native = createModelPhotoHandler(pool, true);
  const request = (method = "GET", body?: unknown, extra: Record<string, string> = {}) => new Request("https://capsule.test/api/model-photo", { method, headers: { origin: "https://capsule.test", "x-capsule-user": owner, "content-type": "application/json", ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  try {
    for (const id of [owner, other]) await pool.query('insert into "user"(id,name,email) values($1,$1,$2)', [id, `${id}@example.test`]);
    const token = await createIntegrationToken(pool, owner, "native", ["outfits:read", "outfits:write"]);
    const otherToken = await createIntegrationToken(pool, other, "native", ["outfits:read", "outfits:write"]);
    const limited = await createIntegrationToken(pool, owner, "limited", ["items:read"]);
    const auth = { authorization: `Bearer ${token.token}` };
    const empty = await web(request()); assert.equal(empty.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await empty.json(), { imageData: null, revision: 0 });
    const imageData = await fixture();
    const saved = await web(request("PUT", { imageData, expectedRevision: 0 })); assert.equal(saved.status, 200);
    const photo = await saved.json(); assert.ok(photo.revision > 0);
    assert.deepEqual(await (await native(request("GET", undefined, auth))).json(), photo);
    // Exact retry after a lost response does not replace the revision or create another record.
    assert.deepEqual(await (await native(request("PUT", { imageData, expectedRevision: 0 }, auth))).json(), photo);
    assert.deepEqual(await (await native(request("GET", undefined, { authorization: `Bearer ${otherToken.token}` }))).json(), { imageData: null, revision: 0 });
    assert.equal((await native(request("GET", undefined, { authorization: `Bearer ${limited.token}` }))).status, 403);
    assert.equal((await native(request())).status, 401);
    assert.equal((await web(request("PUT", { imageData, expectedRevision: photo.revision }, { origin: "https://attacker.test" }))).status, 403);
    currentUser = other; assert.equal((await web(request())).status, 409); currentUser = null;
    assert.equal((await web(request())).status, 401); currentUser = owner;
    assert.equal((await web(request("PUT", { imageData, expectedRevision: photo.revision, userId: other }))).status, 400);
    const newerImage = await fixture("red");
    const results = await Promise.all([
      native(request("PUT", { imageData: newerImage, expectedRevision: photo.revision }, auth)),
      web(request("PUT", { imageData: null, expectedRevision: photo.revision })),
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const current = await (await web(request())).json();
    const deleted = await native(request("PUT", { imageData: null, expectedRevision: current.revision }, auth));
    const tombstone = await deleted.json(); assert.equal(tombstone.imageData, null); assert.ok(tombstone.revision > 0);
    assert.equal((await web(request("PUT", { imageData, expectedRevision: 0 }))).status, 409);
    await pool.query('delete from "user" where id=$1', [owner]);
    assert.equal((await pool.query("select 1 from capsule_model_photos where user_id=$1", [owner])).rowCount, 0);
    assert.equal((await native(request("GET", undefined, auth))).status, 401);
  } finally { await pool.query('delete from "user" where id=any($1::text[])', [[owner, other]]); await pool.end(); }
});
