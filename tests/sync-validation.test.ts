import assert from "node:assert/strict";
import test from "node:test";
import { MAX_IMAGE_CHARS, MAX_SYNC_BYTES, readSyncBody, validateSyncRequest } from "../src/lib/server/sync-validation";
import { MAX_ITEM_IMAGE_CHARS } from "../src/lib/image-limits";

const input = () => ({
  expectedUserId: "test-account", cursor: 0,
  changes: [{ collection: "items", baseRevision: 0, token: crypto.randomUUID(), record: {
    id: crypto.randomUUID(), name: "Shirt", brand: "Brand", size: "M", color: "White", category: "tops",
    price: "20", currency: "USD", description: "Cotton", purchaseUrl: "https://example.com/item",
    imageUrl: "https://example.com/item.jpg", imageData: "data:image/webp;base64,YQ==", createdAt: 1, updatedAt: 1,
  } }],
});
test("sync accepts valid wardrobe records and strips unknown fields", () => {
  const value = input();
  Object.assign(value.changes[0].record, { userId: "another-account", referencePhoto: "private" });
  const parsed = validateSyncRequest(value);
  assert.equal(parsed.changes[0].record.name, "Shirt");
  assert.ok(!("referencePhoto" in parsed.changes[0].record));
  assert.ok(!("userId" in parsed.changes[0].record));
});
test("sync roundtrips front and back images through a JSON request", async () => {
  const value = input();
  Object.assign(value.changes[0].record, {
    backImageUrl: "https://example.com/item-back.jpg",
    backImageData: "data:image/png;base64,Yg==",
  });
  const body = await readSyncBody(new Request("https://capsule.example/api/sync", {
    method: "POST", body: JSON.stringify(value),
  }));
  assert.deepEqual(validateSyncRequest(body).changes[0].record, {
    ...value.changes[0].record, deletedAt: null,
  });
});
test("sync preserves legacy items without adding back image fields", () => {
  const value = input();
  const parsed = validateSyncRequest(value).changes[0].record;
  assert.deepEqual(parsed, { ...value.changes[0].record, deletedAt: null });
  assert.ok(!("backImageUrl" in parsed));
  assert.ok(!("backImageData" in parsed));
});
test("uploaded pieces and transparent cutouts sync without product or image URLs", () => {
  const value = input();
  Object.assign(value.changes[0].record, {
    purchaseUrl: "", imageUrl: "", backImageUrl: "",
    imageData: "data:image/webp;base64,YQ==", backImageData: "data:image/png;base64,Yg==",
  });
  assert.deepEqual(validateSyncRequest(value).changes[0].record, { ...value.changes[0].record, deletedAt: null });
});
test("sync preserves an explicit back image removal", () => {
  const value = input();
  Object.assign(value.changes[0].record, { backImageUrl: "", backImageData: "" });
  assert.deepEqual(validateSyncRequest(value).changes[0].record, {
    ...value.changes[0].record, deletedAt: null,
  });
});
test("sync validates back image links and payloads with the front image rules", () => {
  for (const backImageUrl of [
    "javascript:alert(1)",
    "https://user:password@example.com/back.jpg",
    "not-a-url",
  ]) {
    const value = input();
    Object.assign(value.changes[0].record, { backImageUrl });
    assert.throws(() => validateSyncRequest(value), /invalid link/);
  }
  for (const backImageData of [
    "data:image/svg+xml;base64,YQ==",
    "data:image/webp;base64,invalid!",
    "https://example.com/back.jpg",
  ]) {
    const value = input();
    Object.assign(value.changes[0].record, { backImageData });
    assert.throws(() => validateSyncRequest(value), /unsupported format/);
  }
  for (const fields of [
    { backImageUrl: null },
    { backImageData: null },
    { backImageUrl: "x".repeat(8_001) },
    { backImageData: "x".repeat(MAX_IMAGE_CHARS + 1) },
  ]) {
    const value = input();
    Object.assign(value.changes[0].record, fields);
    assert.throws(() => validateSyncRequest(value), /invalid or too long/);
  }
});
test("front and back image payloads share one item size limit", () => {
  const value = input();
  const prefix = "data:image/png;base64,";
  const front = `${prefix}${"AAAA".repeat(300_000)}`;
  const back = `${prefix}${"AAAA".repeat((MAX_ITEM_IMAGE_CHARS - front.length - prefix.length) / 4)}`;
  assert.equal(front.length + back.length, MAX_ITEM_IMAGE_CHARS);
  Object.assign(value.changes[0].record, { imageData: front, backImageData: back });
  assert.doesNotThrow(() => validateSyncRequest(value));

  Object.assign(value.changes[0].record, { backImageData: `${back}AAAA` });
  assert.ok(front.length < MAX_IMAGE_CHARS && back.length + 4 < MAX_IMAGE_CHARS);
  assert.throws(() => validateSyncRequest(value), /images are too large/);
});
test("sync rejects malformed identities, unsafe links, and unsupported images", () => {
  const badId = input(); badId.changes[0].record.id = "not-a-uuid";
  assert.throws(() => validateSyncRequest(badId), /invalid ID/);
  const badUrl = input(); badUrl.changes[0].record.purchaseUrl = "javascript:alert(1)";
  assert.throws(() => validateSyncRequest(badUrl), /invalid link/);
  const badImage = input(); badImage.changes[0].record.imageData = "data:image/svg+xml;base64,YQ==";
  assert.throws(() => validateSyncRequest(badImage), /unsupported format/);
  const badStamp = input(); badStamp.changes[0].record.updatedAt = -1;
  assert.throws(() => validateSyncRequest(badStamp), /timestamp/);
});
test("sync bounds per-image payloads, record count, and duplicate IDs", () => {
  const large = input(); large.changes[0].record.imageData = "x".repeat(MAX_IMAGE_CHARS + 1);
  assert.throws(() => validateSyncRequest(large), /too long/);
  const duplicate = input(); duplicate.changes.push(duplicate.changes[0]);
  assert.throws(() => validateSyncRequest(duplicate), /twice/);
  const tooMany = input(); tooMany.changes = Array.from({ length: 31 }, () => input().changes[0]);
  assert.throws(() => validateSyncRequest(tooMany), /Too many/);
});
test("request body byte limit is enforced even without Content-Length", async () => {
  const body = "x".repeat(MAX_SYNC_BYTES + 1);
  await assert.rejects(readSyncBody(new Request("https://capsule.example/api/sync", { method: "POST", body })), /too large/);
  const value = input();
  assert.deepEqual(await readSyncBody(new Request("https://capsule.example/api/sync", { method: "POST", body: JSON.stringify(value) })), value);
});
