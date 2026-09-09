import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { createShareStore, hashShareIp, hashShareToken, ShareError, shareExpiry, shareExpiresAt, validateShareId, validateShareSnapshot, validateShareToken, type ShareDatabase, type ShareQuery } from "../src/lib/server/shares";
import { MAX_SHARED_PIECES, type ShareSnapshot } from "../src/lib/share-types";

const id = Buffer.alloc(16, 1).toString("base64url"), token = Buffer.alloc(32, 2).toString("base64url");
const imageData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPuoAAAAASUVORK5CYII=";
const snapshot: ShareSnapshot = { version: 1, kind: "piece", title: "A piece", pieces: [{ name: "Shirt", brand: "", category: "tops", size: "M", color: "White", price: "20", currency: "USD", description: "", purchaseUrl: "https://shop.example/shirt", imageData, rating: 3.5 }] };
const hour = 3_600_000, ipHash = "a".repeat(64);
const errorStatus = (status: number) => (error: unknown) => error instanceof ShareError && error.status === status;

// The adapter exercises the store's transaction boundaries, bound parameters,
// and failure paths without depending on credentials or a production database.
function setup() {
  let now = 1_900_000_000_000;
  let rows = new Map<string, Record<string, unknown>>();
  let limits = new Map<string, { start: number; count: number }>();
  let savedRows = rows, savedLimits = limits;
  const statements: { sql: string; values: unknown[] }[] = [];
  let locked = false, connected = 0, released = 0, ready = true, failInsert = false;
  let queue = Promise.resolve();
  const query: ShareQuery = async (sql, values = []) => {
    const q = sql.replace(/\s+/g, " ").trim(); statements.push({ sql: q, values });
    assert.ok(!q.includes(token)); assert.ok(!values.includes(token));
    if (q === "begin") { savedRows = structuredClone(rows); savedLimits = structuredClone(limits); return { rows: [] }; }
    if (q === "rollback") { rows = savedRows; limits = savedLimits; return { rows: [] }; }
    if (q === "commit") return { rows: [] };
    if (q.includes("pg_advisory_xact_lock")) { assert.match(String(values[0]), /^capsule:share:/); locked = true; return { rows: [] }; }
    if (q.includes("to_regclass")) return { rows: [{ ready }] };
    if (q.startsWith("with expired")) {
      for (const value of rows.values()) if (value.expires_at && Number(value.expires_at) <= Number(values[0])) value.snapshot = null;
      return { rows: [] };
    }
    if (q.startsWith("delete from public.capsule_share_limits")) {
      for (const [key, value] of limits) if (value.start < Number(values[0])) limits.delete(key);
      return { rows: [] };
    }
    if (q.startsWith("insert into public.capsule_share_limits")) {
      assert.equal(locked, true); assert.match(q, /on conflict \(ip_hash\) do update/); assert.match(q, /creations < 10/);
      const key = String(values[0]), time = Number(values[1]), value = limits.get(key);
      if (value && time < value.start + hour && value.count >= 10) return { rows: [] };
      limits.set(key, value && time < value.start + hour ? { ...value, count: value.count + 1 } : { start: time, count: 1 });
      return { rows: [{ ip_hash: key }] };
    }
    const key = String(values[0]), value = rows.get(key);
    if (q.startsWith("select snapshot,")) {
      assert.match(q, /revoked_at is null/); assert.match(q, /expires_at > \$2/);
      return { rows: value && !value.revoked_at && value.snapshot && (!value.expires_at || Number(value.expires_at) > Number(values[1])) ? [structuredClone(value)] : [] };
    }
    if (q.startsWith("select id,")) {
      if (q.endsWith("for update")) assert.equal(locked, true);
      return { rows: value ? [structuredClone(value)] : [] };
    }
    assert.equal(locked, true, "Every mutation holds a share-specific transaction lock");
    if (q.startsWith("insert into public.capsule_shares")) {
      if (failInsert) throw new Error("connection failure");
      assert.equal(rows.has(key), false);
      rows.set(key, q.includes("revoked_at")
        ? { id: key, token_hash: values[1], snapshot: null, expires_at: null, revoked_at: values[2], updated_at: values[2] }
        : { id: key, token_hash: values[1], snapshot: JSON.parse(String(values[2])), expires_at: values[3], updated_at: values[4], expiry: values[5], revoked_at: null });
    } else if (q.startsWith("update public.capsule_shares set snapshot = $2")) {
      assert.match(q, /token_hash = \$4 and revoked_at is null/);
      assert.doesNotMatch(q, /set .*expires_at/);
      Object.assign(value!, { snapshot: JSON.parse(String(values[1])), updated_at: values[2] });
    } else if (q.startsWith("update public.capsule_shares set expires_at")) {
      assert.match(q, /token_hash = \$4 and revoked_at is null/);
      Object.assign(value!, { expires_at: values[1], updated_at: values[2], expiry: values[4] });
    } else if (q.startsWith("update public.capsule_shares set snapshot = null")) {
      assert.match(q, /token_hash = \$3/);
      Object.assign(value!, { snapshot: null, revoked_at: values[1], updated_at: values[1] });
    } else throw new Error(`Unexpected SQL: ${q}`);
    return { rows: [] };
  };
  const database: ShareDatabase = {
    query,
    connect: async () => {
      const previous = queue; let unlock!: () => void;
      queue = new Promise<void>((resolve) => { unlock = resolve; });
      await previous; connected++; locked = false;
      return { query, release: () => { released++; locked = false; unlock(); } };
    },
  };
  return {
    store: createShareStore(database, () => now), statements,
    advance: (time: number) => { now += time; },
    state: () => ({ rows, limits, connected, released, now }),
    setReady: (value: boolean) => { ready = value; },
    setFailInsert: (value: boolean) => { failInsert = value; },
  };
}

test("share capabilities require canonical 128-bit IDs and 256-bit management tokens", () => {
  assert.equal(validateShareId(id), id); assert.equal(validateShareToken(token), token);
  assert.equal(hashShareToken(token).length, 64); assert.ok(!hashShareToken(token).includes(token));
  for (const value of [null, "", token, "a".repeat(21), "a".repeat(22), `${id}/`]) assert.throws(() => validateShareId(value));
  for (const value of [null, "", id, "a".repeat(43), `${token}=`]) assert.throws(() => validateShareToken(value));
});

test("seven days is the default, and explicit thirty-day or never-expiring choices are preserved", () => {
  assert.equal(shareExpiry(), "7d"); assert.equal(shareExpiresAt("7d", 100), 100 + 7 * 86_400_000);
  assert.equal(shareExpiresAt("30d", 100), 100 + 30 * 86_400_000); assert.equal(shareExpiresAt("never", 100), null);
  for (const value of [null, "", "365d", 7]) assert.throws(() => shareExpiry(value));
});

test("public snapshots reject private fields, executable images, arbitrary URLs, and invalid ratings", () => {
  assert.deepEqual(validateShareSnapshot(snapshot), snapshot);
  for (const extra of [{ id: "private" }, { apiKey: "private" }, { referencePhoto: imageData }, { priceHistory: [] }]) {
    assert.throws(() => validateShareSnapshot({ ...snapshot, ...extra }));
    assert.throws(() => validateShareSnapshot({ ...snapshot, pieces: [{ ...snapshot.pieces[0], ...extra }] }));
  }
  for (const value of ["https://shop.example/photo.png", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,PHN2Zy8+", "data:image/png;base64,a", "data:image/png;base64,iVBORw0KGgo=\n", "data:text/html;base64,PHN2Zy8+"]) {
    assert.throws(() => validateShareSnapshot({ ...snapshot, pieces: [{ ...snapshot.pieces[0], imageData: value }] }));
  }
  for (const purchaseUrl of ["javascript:alert(1)", "data:text/html,hi", "https://user:pass@example.com", "/relative"]) {
    assert.throws(() => validateShareSnapshot({ ...snapshot, pieces: [{ ...snapshot.pieces[0], purchaseUrl }] }));
  }
  for (const rating of [0.1, -1, 5.5, NaN, Infinity]) assert.throws(() => validateShareSnapshot({ ...snapshot, pieces: [{ ...snapshot.pieces[0], rating }] }));
  for (const rating of [0, 0.5, 3.5, 5, null]) assert.equal(validateShareSnapshot({ ...snapshot, pieces: [{ ...snapshot.pieces[0], rating }] }).pieces[0].rating, rating);
});

test("shared collection and outfit shapes have bounded, distinct requirements", () => {
  for (const kind of ["wardrobe", "wishlist", "piece"] as const) assert.throws(() => validateShareSnapshot({ ...snapshot, kind, pieces: [] }));
  assert.throws(() => validateShareSnapshot({ ...snapshot, pieces: [snapshot.pieces[0], snapshot.pieces[0]] }));
  assert.throws(() => validateShareSnapshot({ ...snapshot, kind: "wardrobe", pieces: Array(MAX_SHARED_PIECES + 1).fill(snapshot.pieces[0]) }));
  assert.throws(() => validateShareSnapshot({ ...snapshot, kind: "outfit" }));
  assert.throws(() => validateShareSnapshot({ ...snapshot, outfitImageData: imageData }));
  assert.throws(() => validateShareSnapshot({ ...snapshot, kind: "outfit", outfitImageData: imageData, pieces: Array(7).fill(snapshot.pieces[0]) }));
  assert.equal(validateShareSnapshot({ ...snapshot, kind: "outfit", outfitImageData: imageData, pieces: [] }).pieces.length, 0);
});

test("rate-limit identities are keyed digests and never retain a raw IP", () => {
  const request = new Request("https://capsule.example/api/share", { headers: { "x-vercel-forwarded-for": "203.0.113.7" } });
  const hash = hashShareIp(request, "server-secret");
  assert.match(hash, /^[a-f0-9]{64}$/); assert.ok(!hash.includes("203.0.113.7"));
  assert.equal(hashShareIp(request, "server-secret"), hash); assert.notEqual(hashShareIp(request, "rotated-secret"), hash);
  assert.notEqual(hashShareIp(new Request(request.url), "server-secret"), hash);
});

test("creation is idempotent, persists only a token hash, and never republishes changed retry content", async () => {
  const { store, state, advance } = setup();
  const first = await store.create(id, token, snapshot, "7d", ipHash); advance(1000);
  const retry = await store.create(id, token, { ...snapshot, title: "Changed retry" }, "never", ipHash);
  assert.deepEqual(retry, first); assert.equal(state().limits.get(ipHash)?.count, 1);
  assert.equal(state().rows.get(id)?.token_hash, hashShareToken(token));
  assert.deepEqual((await store.get(id))?.snapshot, snapshot);
  assert.deepEqual(await store.inspect(id, token), first);
  assert.equal(state().connected, state().released);
});

test("unrelated tokens cannot inspect, change, or revoke another share", async () => {
  const { store } = setup(); const other = randomBytes(32).toString("base64url");
  await store.create(id, token, snapshot, "7d", ipHash);
  for (const action of [
    () => store.inspect(id, other), () => store.create(id, other, snapshot, "7d", ipHash),
    () => store.update(id, other, snapshot), () => store.changeExpiry(id, other, "never"), () => store.remove(id, other, ipHash),
  ]) await assert.rejects(action, errorStatus(403));
  assert.deepEqual((await store.get(id))?.snapshot, snapshot);
});

test("expiry changes preserve the snapshot while explicit updates replace only the public selection", async () => {
  const { store, advance, state } = setup();
  await store.create(id, token, snapshot, "7d", ipHash); advance(1000);
  const extended = await store.changeExpiry(id, token, "never"); assert.equal(extended.expiresAt, null);
  assert.deepEqual((await store.get(id))?.snapshot, snapshot);
  const changed = { ...snapshot, title: "Updated public selection" };
  const updated = await store.update(id, token, changed);
  assert.equal(updated.expiresAt, null); assert.equal(updated.expiry, "never");
  assert.deepEqual((await store.get(id))?.snapshot, changed);
  const timed = await store.changeExpiry(id, token, "30d");
  advance(25 * 86_400_000);
  const afterEdit = await store.update(id, token, snapshot);
  assert.equal(afterEdit.expiresAt, timed.expiresAt);
  assert.equal(afterEdit.expiry, "30d");
  assert.equal((await store.inspect(id, token)).expiry, "30d");
  assert.equal(afterEdit.updatedAt, state().now);
});

test("expired snapshots disappear on public reads and cannot be resurrected by retries or edits", async () => {
  const { store, advance, state } = setup();
  await store.create(id, token, snapshot, "7d", ipHash); advance(7 * 86_400_000);
  assert.equal(await store.get(id), null); assert.equal(state().rows.get(id)?.snapshot, null);
  for (const action of [() => store.inspect(id, token), () => store.create(id, token, snapshot, "never", ipHash), () => store.update(id, token, snapshot), () => store.changeExpiry(id, token, "never")]) await assert.rejects(action, errorStatus(410));
  await store.remove(id, token, ipHash); assert.ok(state().rows.get(id)?.revoked_at);
});

test("revocation is idempotent, clears content, and wins either order of an initial creation race", async () => {
  for (const revokeFirst of [false, true]) {
    const { store, state } = setup();
    const actions = [() => store.create(id, token, snapshot, "7d", ipHash), () => store.remove(id, token, ipHash)];
    if (revokeFirst) actions.reverse();
    const results = await Promise.allSettled(actions.map((action) => action()));
    assert.equal(results[revokeFirst ? 0 : 1].status, "fulfilled");
    assert.equal(await store.get(id), null); assert.equal(state().rows.get(id)?.snapshot, null);
    await store.remove(id, token, ipHash);
    await assert.rejects(() => store.create(id, token, snapshot, "never", ipHash), errorStatus(410));
    assert.equal(state().limits.get(ipHash)?.count, 1);
  }
});

test("ten creation attempts per IP per hour are atomic, retries are free, and existing revocation stays available", async () => {
  const { store, state, advance } = setup();
  const ids = Array.from({ length: 11 }, () => randomBytes(16).toString("base64url"));
  const results = await Promise.allSettled(ids.map((value) => store.create(value, token, snapshot, "7d", ipHash)));
  assert.equal(results.filter((value) => value.status === "fulfilled").length, 10);
  const rejected = results.find((value) => value.status === "rejected"); assert.ok(rejected?.status === "rejected" && errorStatus(429)(rejected.reason));
  assert.equal(state().rows.size, 10);
  await store.create(ids[0], token, snapshot, "7d", ipHash);
  await store.remove(ids[0], token, ipHash);
  assert.equal(state().limits.get(ipHash)?.count, 10);
  await assert.rejects(() => store.remove(randomBytes(16).toString("base64url"), token, ipHash), errorStatus(429));
  advance(hour);
  await store.create(ids[10], token, snapshot, "never", ipHash);
  assert.equal(state().limits.get(ipHash)?.count, 1);
});

test("failed writes roll back rate charges and always release connections; readiness is explicit", async () => {
  const { store, state, setFailInsert, setReady } = setup();
  assert.equal(await store.configured(), true); setReady(false); assert.equal(await store.configured(), false);
  setFailInsert(true);
  await assert.rejects(() => store.create(id, token, snapshot, "7d", ipHash));
  assert.equal(state().limits.size, 0); assert.equal(state().rows.size, 0);
  assert.equal(state().connected, state().released);
  setFailInsert(false); await store.create(id, token, snapshot, "7d", ipHash);
  assert.equal(state().limits.get(ipHash)?.count, 1);
});
