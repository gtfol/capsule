import assert from "node:assert/strict";
import test from "node:test";
import { assignPhotoSlot, selectPhotoSlot, type PhotoSide, type PhotoSlots } from "../src/lib/photo-slots";

test("previewing assigned thumbnails follows their view without changing saved photo assignments", () => {
  // IDs and thumbnail order need not match their assigned view after editing.
  const photos = { frontId: "third", backId: "first", sideId: "second" };
  for (const active of ["front", "back", "side"] as const) {
    for (const target of ["front", "back", "side"] as const) {
      const selected = selectPhotoSlot(photos, active, photos[`${target}Id`]);
      assert.equal(selected.side, target);
      assert.equal(selected.photos, photos); // Navigation must not mark the editor dirty.
    }
  }
});

test("empty views can navigate back to assigned thumbnails; new gallery photos still fill the selected view", () => {
  const photos = { frontId: "front", backId: null, sideId: "side" };
  assert.deepEqual(selectPhotoSlot(photos, "back", "front"), { photos, side: "front" });
  assert.deepEqual(selectPhotoSlot(photos, "back", "new"), {
    photos: { ...photos, backId: "new" }, side: "back",
  });
  assert.deepEqual(selectPhotoSlot(photos, "front", "new"), {
    photos: { ...photos, frontId: "new" }, side: "front",
  });
});

test("front, back, and side assignments swap without duplicating or dropping photos", () => {
  const original = { frontId: "front", backId: "back", sideId: "side", choices: ["front", "back", "side"] };
  for (const target of ["front", "back", "side"] as const) {
    for (const id of original.choices) {
      const updated = assignPhotoSlot(original, target, id);
      assert.equal(updated[`${target}Id`], id);
      assert.deepEqual([updated.frontId, updated.backId, updated.sideId].sort(), ["back", "front", "side"]);
      assert.equal(updated.choices, original.choices);
    }
  }
  assert.deepEqual(original, { frontId: "front", backId: "back", sideId: "side", choices: ["front", "back", "side"] });
});

test("empty optional slots can move another optional photo without emptying front", () => {
  const original: PhotoSlots = { frontId: "front", backId: "back", sideId: null };
  assert.equal(assignPhotoSlot(original, "side", "front"), original);
  assert.deepEqual(assignPhotoSlot(original, "side", "back"), { frontId: "front", backId: null, sideId: "back" });
  assert.deepEqual(assignPhotoSlot(original, "side", "new"), { frontId: "front", backId: "back", sideId: "new" });
  assert.deepEqual(assignPhotoSlot({ frontId: "front", backId: null, sideId: "side" }, "front", "side"), { frontId: "side", backId: null, sideId: "front" });
});

test("repeated assignments preserve a nonempty front and exclusive occupied slots", () => {
  let slots: PhotoSlots = { frontId: "a", backId: null, sideId: null };
  const operations: Array<[PhotoSide, string]> = [["side", "b"], ["back", "b"], ["side", "a"], ["side", "c"], ["front", "c"], ["back", "a"], ["front", "d"], ["side", "b"]];
  for (const [side, id] of operations) {
    slots = assignPhotoSlot(slots, side, id);
    const assigned = [slots.frontId, slots.backId, slots.sideId].filter(Boolean);
    assert.ok(slots.frontId);
    assert.equal(new Set(assigned).size, assigned.length);
  }
});
