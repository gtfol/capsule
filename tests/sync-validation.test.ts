import assert from "node:assert/strict";
import test from "node:test";
import { MAX_IMAGE_CHARS, MAX_SYNC_BYTES, readSyncBody, validateSyncRequest } from "../src/lib/server/sync-validation";

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
