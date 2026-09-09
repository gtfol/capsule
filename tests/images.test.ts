import assert from "node:assert/strict";
import test from "node:test";
import { cacheProductImages } from "../src/lib/images";

test("cached front and back images can be saved offline without changing either image", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Offline"); };
  try {
    const front = { imageUrl: "https://example.com/front.jpg", imageData: "data:image/jpeg;base64,YQ==" };
    const back = { imageUrl: "https://example.com/back.jpg", imageData: "data:image/jpeg;base64,Yg==" };
    assert.deepEqual(await cacheProductImages(front, back), { imageData: front.imageData, backImageData: back.imageData });
    assert.deepEqual(await cacheProductImages(back, front), { imageData: back.imageData, backImageData: front.imageData });
    assert.deepEqual(await cacheProductImages(front), { imageData: front.imageData });
  } finally { globalThis.fetch = originalFetch; }
});

test("an unavailable back image rejects the save without changing the cached front", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 404 });
  try {
    const front = Object.freeze({ imageUrl: "https://example.com/front.jpg", imageData: "data:image/jpeg;base64,YQ==" });
    await assert.rejects(cacheProductImages(front, { imageUrl: "https://example.com/back.jpg" }), /could not be saved/);
    assert.equal(front.imageData, "data:image/jpeg;base64,YQ==");
  } finally { globalThis.fetch = originalFetch; }
});
