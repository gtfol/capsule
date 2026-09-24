import assert from "node:assert/strict";
import test from "node:test";
import { getProductPreviewImages } from "../src/lib/product-preview";

const front = "https://example.com/front.jpg";
const back = "https://example.com/back.jpg";
const side = "https://example.com/side.jpg";
const frontData = "data:image/webp;base64,RlJPTlQ=";
const backData = "data:image/webp;base64,QkFDSw==";
const sideData = "data:image/webp;base64,U0lERQ==";

test("all eight view combinations obey front/back, side/back, front/side priority", () => {
  for (const [hasFront, hasBack, hasSide, expected] of [
    [true, true, true, ["front", "back"]],
    [true, true, false, ["front", "back"]],
    [false, true, true, ["side", "back"]],
    [true, false, true, ["front", "side"]],
    [true, false, false, ["front", undefined]],
    [false, true, false, ["back", undefined]],
    [false, false, true, ["side", undefined]],
    [false, false, false, [undefined, undefined]],
  ] as const) {
    const pair = getProductPreviewImages({ imageUrl: hasFront ? front : "", backImageUrl: hasBack ? back : undefined, sideImageUrl: hasSide ? side : undefined });
    assert.deepEqual([pair.primary?.side, pair.secondary?.side], expected);
  }
});

test("locally uploaded views work without any listing URLs or a front view", () => {
  const pair = getProductPreviewImages({ imageUrl: "", backImageData: backData, sideImageData: sideData });
  assert.deepEqual(pair, {
    primary: { side: "side", imageUrl: "", imageData: sideData },
    secondary: { side: "back", imageUrl: "", imageData: backData },
  });
  assert.deepEqual(getProductPreviewImages({ imageUrl: "", sideImageData: sideData }).primary, pair.primary);
  assert.equal(getProductPreviewImages({ imageUrl: "", imageData: "", backImageData: "  ", sideImageUrl: " " }).primary, null);
});

test("cached and remote views can mix, with absent cached data falling back to its URL", () => {
  const pair = getProductPreviewImages({ imageUrl: front, imageData: "", backImageUrl: "", sideImageData: sideData });
  assert.deepEqual(pair.primary, { side: "front", imageUrl: front });
  assert.deepEqual(pair.secondary, { side: "side", imageUrl: "", imageData: sideData });
  const cached = getProductPreviewImages({ imageUrl: front, imageData: frontData, backImageUrl: back });
  assert.equal(cached.primary?.imageData, frontData);
  assert.equal(cached.secondary?.imageUrl, back);
});

test("duplicate URLs or cached pixels never create an identical hover pair", () => {
  assert.equal(getProductPreviewImages({ imageUrl: front, backImageUrl: front }).secondary, null);
  assert.equal(getProductPreviewImages({ imageUrl: front, imageData: frontData, backImageUrl: back, backImageData: frontData }).secondary, null);
  assert.equal(getProductPreviewImages({ imageUrl: front, imageData: frontData, backImageUrl: front }).secondary, null);
  const remaining = getProductPreviewImages({ imageUrl: front, backImageUrl: front, sideImageUrl: side });
  assert.deepEqual([remaining.primary?.side, remaining.secondary?.side], ["side", "back"]);
  const distinctPixels = getProductPreviewImages({ imageUrl: front, imageData: frontData, backImageUrl: front, backImageData: backData });
  assert.deepEqual([distinctPixels.primary?.imageData, distinctPixels.secondary?.imageData], [frontData, backData]);
});
