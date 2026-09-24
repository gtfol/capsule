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
test("sync roundtrips front, back, and side images through a JSON request", async () => {
  const value = input();
  Object.assign(value.changes[0].record, {
    backImageUrl: "https://example.com/item-back.jpg",
    backImageData: "data:image/png;base64,Yg==",
    sideImageUrl: "https://example.com/item-side.jpg",
    sideImageData: "data:image/webp;base64,Yw==",
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
  assert.ok(!("sideImageUrl" in parsed));
  assert.ok(!("sideImageData" in parsed));
});
test("uploaded pieces and transparent cutouts sync without product or image URLs", () => {
  const value = input();
  Object.assign(value.changes[0].record, {
    purchaseUrl: "", imageUrl: "", backImageUrl: "", sideImageUrl: "",
    imageData: "data:image/webp;base64,YQ==", backImageData: "data:image/png;base64,Yg==", sideImageData: "data:image/webp;base64,Yw==",
  });
  assert.deepEqual(validateSyncRequest(value).changes[0].record, { ...value.changes[0].record, deletedAt: null });
});
test("sync preserves explicit back and side image removals", () => {
  const value = input();
  Object.assign(value.changes[0].record, { backImageUrl: "", backImageData: "", sideImageUrl: "", sideImageData: "" });
  assert.deepEqual(validateSyncRequest(value).changes[0].record, {
    ...value.changes[0].record, deletedAt: null,
  });
});
test("sync supports a side photo without adding a back photo", () => {
  const value = input();
  Object.assign(value.changes[0].record, { sideImageUrl: "", sideImageData: "data:image/webp;base64,Yw==" });
  const parsed = validateSyncRequest(value).changes[0].record;
  assert.deepEqual(parsed, { ...value.changes[0].record, deletedAt: null });
  assert.ok(!("backImageUrl" in parsed));
  assert.ok(!("backImageData" in parsed));
});
test("sync applies link and image validation to the optional side photo", () => {
  for (const sideImageUrl of ["javascript:alert(1)", "https://user:password@example.com/side.jpg", "not-a-url"]) {
    const value = input();
    Object.assign(value.changes[0].record, { sideImageUrl });
    assert.throws(() => validateSyncRequest(value), /invalid link/);
  }
  for (const sideImageData of ["data:image/svg+xml;base64,YQ==", "data:image/webp;base64,invalid!", "https://example.com/side.jpg"]) {
    const value = input();
    Object.assign(value.changes[0].record, { sideImageData });
    assert.throws(() => validateSyncRequest(value), /unsupported format/);
  }
  for (const fields of [{ sideImageUrl: null }, { sideImageData: null }, { sideImageUrl: "x".repeat(8_001) }, { sideImageData: "x".repeat(MAX_IMAGE_CHARS + 1) }]) {
    const value = input();
    Object.assign(value.changes[0].record, fields);
    assert.throws(() => validateSyncRequest(value), /invalid or too long/);
  }
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
test("the side view shares the same total image limit with front and back", () => {
  const value = input();
  const front = `data:image/jpeg;base64,${"AAAA".repeat(250_000)}`;
  const back = `data:image/png;base64,${"AAAA".repeat(250_000)}`;
  const prefix = "data:image/webp;base64,";
  const side = `${prefix}${"AAAA".repeat((MAX_ITEM_IMAGE_CHARS - front.length - back.length - prefix.length) / 4)}`;
  assert.equal(front.length + back.length + side.length, MAX_ITEM_IMAGE_CHARS);
  Object.assign(value.changes[0].record, { imageData: front, backImageData: back, sideImageData: side });
  assert.doesNotThrow(() => validateSyncRequest(value));
  Object.assign(value.changes[0].record, { sideImageData: `${side}AAAA` });
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

test("sync preserves opaque piece identities while rejecting malformed values", () => {
  const value = input();
  Object.assign(value.changes[0].record, { sourceKey: "a".repeat(64) });
  assert.equal((validateSyncRequest(value).changes[0].record as { sourceKey: string }).sourceKey, "a".repeat(64));
  for (const sourceKey of ["raw-local-id", "", "a".repeat(65), 1, null]) {
    Object.assign(value.changes[0].record, { sourceKey });
    assert.throws(() => validateSyncRequest(value), /source identity/);
  }
});
