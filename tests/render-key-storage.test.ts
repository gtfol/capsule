import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { clearLegacyRenderKeys, openDatabase, readSnapshot } from "../src/lib/db";
import { createRenderKeyStore, decryptRenderKey, encryptRenderKey, RenderKeyError, validateRenderKey } from "../src/lib/server/render-key-storage";

Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });
const fakeKey = "sk-test-only-never-a-real-provider-key";
const secret = randomBytes(32).toString("base64");

test("account keys use randomized authenticated encryption bound to the owner", () => {
  const first = encryptRenderKey("alice", fakeKey, secret);
  const second = encryptRenderKey("alice", fakeKey, secret);
  assert.notEqual(first, second);
  assert.ok(!first.includes(fakeKey));
  assert.equal(decryptRenderKey("alice", first, secret), fakeKey);
  assert.throws(() => decryptRenderKey("bob", first, secret), RenderKeyError);
  assert.throws(() => decryptRenderKey("alice", first, randomBytes(32).toString("base64")), RenderKeyError);
  for (const index of [1, 2, 3]) {
    const parts = first.split("."); const bytes = Buffer.from(parts[index], "base64"); bytes[0] ^= 1; parts[index] = bytes.toString("base64");
    assert.throws(() => decryptRenderKey("alice", parts.join("."), secret), RenderKeyError);
  }
  for (const malformed of ["", "v9.a.b.c", `${first}.extra`, "x".repeat(901)]) assert.throws(() => decryptRenderKey("alice", malformed, secret), RenderKeyError);
});

test("invalid encryption configuration and malformed credentials fail closed", () => {
  for (const config of [undefined, "", "a".repeat(32), randomBytes(16).toString("base64"), secret + "\n"]) {
    assert.throws(() => encryptRenderKey("alice", fakeKey, config), (error) => error instanceof RenderKeyError && error.status === 503 && !error.message.includes(fakeKey));
  }
  for (const key of [undefined, "", "not-an-api-key", "sk-short"]) assert.throws(() => validateRenderKey(key), RenderKeyError);
  assert.equal(validateRenderKey(` ${fakeKey}\n`), fakeKey);
});

test("only ciphertext enters SQL and all database actions are scoped to their owner", async () => {
  const records = new Map<string, string>();
  const store = createRenderKeyStore(async (sql, values) => {
    assert.ok(sql.includes("$1"));
    assert.ok(!sql.includes(fakeKey));
    assert.ok(values.every((value) => !value.includes(fakeKey)));
    const user = values[0];
    if (sql.startsWith("insert")) records.set(user, values[1]);
    if (sql.startsWith("delete")) records.delete(user);
    return { rows: sql.startsWith("select") && records.has(user) ? [{ encrypted_key: records.get(user)! }] : [] };
  }, () => secret);
  assert.equal(await store.has("alice"), false);
  await store.save("alice", fakeKey);
  assert.equal(await store.has("alice"), true);
  assert.equal(await store.has("bob"), false);
  assert.equal(await store.load("alice"), fakeKey);
  assert.equal(await store.load("bob"), null);
  await store.save("bob", fakeKey);
  assert.notEqual(records.get("alice"), records.get("bob"));
  await store.remove("alice");
  assert.equal(await store.load("alice"), null);
  assert.equal(await store.load("bob"), fakeKey);
});

test("old preview credentials are deleted from all browser spaces without touching photos", async () => {
  const db = await openDatabase();
  const tx = db.transaction("meta", "readwrite");
  const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  const meta = tx.objectStore("meta");
  meta.put({ key: "guest|render-api-key", value: "fake-old-guest-key" });
  meta.put({ key: "account:alice|render-api-key", value: "fake-old-account-key" });
  meta.put({ key: "guest|reference-photo", value: "test-photo" });
  await done;
  await clearLegacyRenderKeys();
  const keys = await new Promise<IDBValidKey[]>((resolve) => { const request = db.transaction("meta").objectStore("meta").getAllKeys(); request.onsuccess = () => resolve(request.result); });
  assert.ok(!keys.some((key) => String(key).endsWith("|render-api-key")));
  assert.equal((await readSnapshot("guest")).referencePhoto, "test-photo");
  await clearLegacyRenderKeys();
});
