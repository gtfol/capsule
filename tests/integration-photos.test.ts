import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { prepareIntegrationPhotos } from "../src/lib/server/integration-photos";

test("uploaded photos are decoded, resized, stripped of metadata and preserve transparency", async () => {
  const png = await sharp({create:{width:1800,height:100,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().withMetadata().toBuffer();
  const photos = await prepareIntegrationPhotos({imageData:`data:image/png;base64,${png.toString("base64")}`,backImageUrl:"https://shop.test/back.jpg",sideImageData:""});
  assert.equal(photos.imageUrl,"");
  assert.equal(photos.backImageData,"");
  assert.equal(photos.sideImageUrl,"");
  assert.equal(photos.sideImageData,"");
  const metadata = await sharp(Buffer.from(photos.imageData!.split(",")[1],"base64")).metadata();
  assert.equal(metadata.format,"webp");
  assert.equal(metadata.width,1600);
  assert.equal(metadata.hasAlpha,true);
  assert.equal(metadata.exif,undefined);
});

test("photo uploads reject ambiguous views, disguised files, truncated images and excessive pixels", async () => {
  await assert.rejects(prepareIntegrationPhotos({imageUrl:"",imageData:""}),/either an image URL/);
  await assert.rejects(prepareIntegrationPhotos({imageData:`data:image/png;base64,${Buffer.from('<svg/>').toString('base64')}`}),/valid JPEG/);
  const png = await sharp({create:{width:10,height:10,channels:3,background:"white"}}).png().toBuffer();
  await assert.rejects(prepareIntegrationPhotos({imageData:`data:image/png;base64,${png.subarray(0,20).toString('base64')}`}),/valid JPEG/);
  const large = await sharp({create:{width:6000,height:5000,channels:3,background:"white"}}).png().toBuffer();
  await assert.rejects(prepareIntegrationPhotos({imageData:`data:image/png;base64,${large.toString('base64')}`}),/25 megapixels/);
  await assert.rejects(prepareIntegrationPhotos({imageData:`data:image/png;base64,${'A'.repeat(2_000_100)}`}),/1.5 MB/);
});
