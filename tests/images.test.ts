import assert from "node:assert/strict";
import test from "node:test";
import { cacheProductImages, imageSource, prepareUploadedImage } from "../src/lib/images";
import { MAX_ITEM_IMAGE_CHARS } from "../src/lib/image-limits";

test("cached front, back, and side images can be saved offline without changing any image", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Offline"); };
  try {
    const front = { imageUrl: "https://example.com/front.jpg", imageData: "data:image/jpeg;base64,YQ==" };
    const back = { imageUrl: "https://example.com/back.jpg", imageData: "data:image/jpeg;base64,Yg==" };
    const side = { imageUrl: "https://example.com/side.jpg", imageData: "data:image/webp;base64,Yw==" };
    assert.deepEqual(await cacheProductImages(front, back, side), { imageData: front.imageData, backImageData: back.imageData, sideImageData: side.imageData });
    assert.deepEqual(await cacheProductImages(front, undefined, side), { imageData: front.imageData, sideImageData: side.imageData });
    assert.deepEqual(await cacheProductImages(front, back), { imageData: front.imageData, backImageData: back.imageData });
    assert.deepEqual(await cacheProductImages(back, front), { imageData: back.imageData, backImageData: front.imageData });
    assert.deepEqual(await cacheProductImages(front), { imageData: front.imageData });
  } finally { globalThis.fetch = originalFetch; }
});

test("uploaded front, back, and side photos retain independent data without online URLs", async () => {
  const front = { imageUrl: "", imageData: "data:image/webp;base64,YQ==" };
  const back = { imageUrl: "", imageData: "data:image/webp;base64,Yg==" };
  const side = { imageUrl: "", imageData: "data:image/png;base64,Yw==" };
  assert.deepEqual(await cacheProductImages(front, back, side), { imageData: front.imageData, backImageData: back.imageData, sideImageData: side.imageData });
  assert.deepEqual(await cacheProductImages(front, undefined, side), { imageData: front.imageData, sideImageData: side.imageData });
  assert.deepEqual(await cacheProductImages(front, back), { imageData: front.imageData, backImageData: back.imageData });
  assert.equal(imageSource(front), front.imageData);
  assert.equal(imageSource({ imageUrl: "" }), "");
  await assert.rejects(cacheProductImages({ imageUrl: "" }), /Choose a photo/);
});

test("photo uploads reject empty, oversized, and unsupported files before decoding", async () => {
  await assert.rejects(prepareUploadedImage(new File([], "empty.jpg", { type: "image/jpeg" })), /empty/);
  await assert.rejects(prepareUploadedImage(new File([new Uint8Array(20_000_001)], "large.jpg", { type: "image/jpeg" })), /20 MB/);
  await assert.rejects(prepareUploadedImage(new File(["<svg></svg>"], "image.svg", { type: "image/svg+xml" })), /JPG, PNG, WebP, or AVIF/);
});

test("an unavailable back or side image rejects the save without changing the cached front", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 404 });
  try {
    const front = Object.freeze({ imageUrl: "https://example.com/front.jpg", imageData: "data:image/jpeg;base64,YQ==" });
    await assert.rejects(cacheProductImages(front, { imageUrl: "https://example.com/back.jpg" }), /could not be saved/);
    await assert.rejects(cacheProductImages(front, undefined, { imageUrl: "https://example.com/side.jpg" }), /could not be saved/);
    assert.equal(front.imageData, "data:image/jpeg;base64,YQ==");
  } finally { globalThis.fetch = originalFetch; }
});

async function withImageProcessing(output: (index: number) => string, run: (formats: string[]) => Promise<void>) {
  const originals = new Map(["fetch", "createImageBitmap", "document"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const formats: string[] = [];
  let encoded = 0;
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async () => new Response(new Blob(["pixels"], { type: "image/png" })) });
  Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: async () => ({ width: 1400, height: 1400, close() {} }) });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: (format: string) => { formats.push(format); return output(encoded++); } }),
  } });
  try { await run(formats); }
  finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("three views compress together within one budget while preserving transparent slots", async () => {
  const data = `data:image/png;base64,${"A".repeat(1_000_000)}`;
  const image = { imageUrl: "", imageData: data };
  const outputs = ["data:image/webp;base64,YQ==", "data:image/webp;base64,Yg==", "data:image/webp;base64,Yw=="];
  await withImageProcessing((index) => outputs[index], async (formats) => {
    assert.deepEqual(await cacheProductImages(image, image, image), { imageData: outputs[0], backImageData: outputs[1], sideImageData: outputs[2] });
    assert.deepEqual(formats, ["image/webp", "image/webp", "image/webp"]);
  });
  assert.equal(image.imageData, data);
});

test("compression retains a side-only optional slot and rejects a total still above budget", async () => {
  const data = `data:image/webp;base64,${"A".repeat(1_500_000)}`;
  const image = { imageUrl: "", imageData: data };
  const outputs = ["data:image/webp;base64,YQ==", "data:image/webp;base64,Yw=="];
  await withImageProcessing((index) => outputs[index], async () => {
    assert.deepEqual(await cacheProductImages(image, undefined, image), { imageData: outputs[0], sideImageData: outputs[1] });
  });
  const tooLarge = `data:image/webp;base64,${"A".repeat(Math.ceil(MAX_ITEM_IMAGE_CHARS / 3))}`;
  await withImageProcessing(() => tooLarge, async (formats) => {
    await assert.rejects(cacheProductImages(image, image, image), /too large to save/);
    assert.equal(formats.length, 9);
  });
});
