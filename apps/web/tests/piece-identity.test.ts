import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { findDuplicatePiece, pieceSourceKey, previewSharedPieces, productLinkKey } from "../src/lib/piece-identity";
import type { Item } from "../src/lib/types";

const original: Item = { id: crypto.randomUUID(), name: "Cotton shirt", brand: "Studio", category: "tops", size: "M", color: "Black", price: "20", currency: "USD", description: "", purchaseUrl: "https://shop.example/shirt?variant=1", imageUrl: "", createdAt: 1, updatedAt: 1 };

test("identity recognizes an original and re-shared copies despite edited details", () => {
  const sourceKey = pieceSourceKey(original);
  assert.equal(sourceKey, createHash("sha256").update(`capsule-piece-v1:${original.id}`).digest("hex"));
  assert.ok(!sourceKey.includes(original.id));
  const shared = { ...original, sourceKey, name: "Renamed", purchaseUrl: "", size: "L", color: "Blue" };
  assert.equal(findDuplicatePiece(shared, [original])?.id, original.id);
  const copy = { ...shared, id: crypto.randomUUID() };
  assert.equal(pieceSourceKey(copy), sourceKey);
  assert.equal(findDuplicatePiece(shared, [copy])?.id, copy.id);
  assert.equal(findDuplicatePiece(shared, [{ ...copy, deletedAt: 5 }]), undefined);
});

test("product matching removes tracking, sorts parameters and normalizes size/color whitespace and case", () => {
  const incoming = { ...original, purchaseUrl: "http://shop.example/shirt/?utm_source=friend&variant=1&gclid=123", size: " m ", color: " black " };
  assert.equal(findDuplicatePiece(incoming, [original])?.id, original.id);
  assert.equal(productLinkKey("https://shop.example/a?b=2&a=1&utm_medium=share"), productLinkKey("https://shop.example/a?a=1&b=2"));
});

test("different and unknown variants remain separate, without name similarity matching", () => {
  for (const change of [{ size: "L" }, { size: "" }, { color: "White" }, { color: "" }, { category: "bottoms" as const }, { purchaseUrl: "https://shop.example/shirt?variant=2" }, { purchaseUrl: "https://shop.example/shirt?variant=1#blue" }, { purchaseUrl: "https://other.example/shirt?variant=1" }, { purchaseUrl: "" }]) {
    assert.equal(findDuplicatePiece({ ...original, ...change }, [original]), undefined, JSON.stringify(change));
  }
  const renamed = { ...original, name: "A totally different name", brand: "Edited brand" };
  assert.equal(findDuplicatePiece(renamed, [original])?.id, original.id);
  for (const url of ["", "invalid", "javascript:alert(1)", "https://user:secret@shop.example/shirt?variant=1"]) assert.equal(productLinkKey(url), null);
});

test("alternative wishlist listings participate in exact product matching", () => {
  const existing = { ...original, purchaseUrl: "https://retailer.example/shirt", sources: [{ url: original.purchaseUrl }] };
  assert.equal(findDuplicatePiece(original, [existing])?.id, existing.id);
});

test("bulk preview counts both owned pieces and repeated new pieces", () => {
  const newPiece = { ...original, purchaseUrl: "https://shop.example/new" };
  const preview = previewSharedPieces([original, newPiece, { ...newPiece, name: "Other name" }], [original]);
  assert.equal(preview.added, 1);
  assert.equal(preview.skipped, 2);
  assert.equal(preview.matches[0]?.id, original.id);
  assert.equal(preview.matches[1], null);
});
