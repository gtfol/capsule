"use client";
import { MAX_ITEM_IMAGE_CHARS } from "./image-limits";

interface ProductImage { imageUrl: string; imageData?: string; }

export function imageSource(image: { imageData?: string; imageUrl: string }) { return image.imageData || `/api/image?url=${encodeURIComponent(image.imageUrl)}`; }
export async function compressImage(source: Blob | string, maxDimension = 1400, quality = 0.86): Promise<string> {
  const blob = typeof source === "string" ? await (await fetch(source)).blob() : source;
  if (!/^image\/(jpeg|png|webp|avif)$/.test(blob.type)) throw new Error("Choose a JPG, PNG, WebP, or AVIF image.");
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not process the image.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally { bitmap.close(); }
}
async function loadProductImage(image: ProductImage): Promise<string> {
  if (image.imageData) return image.imageData;
  const response = await fetch(`/api/image?url=${encodeURIComponent(image.imageUrl)}`);
  if (!response.ok) throw new Error("The product image could not be saved. Try another image from this page.");
  return compressImage(await response.blob());
}

export async function cacheProductImages(front: ProductImage, back?: ProductImage): Promise<{ imageData: string; backImageData?: string }> {
  const originals = await Promise.all([loadProductImage(front), ...(back ? [loadProductImage(back)] : [])]);
  let images: string[] = originals;
  // Existing cached images stay untouched unless the pair exceeds the shared
  // budget. Resize from the originals on each pass, avoiding repeated JPEG loss.
  for (const [dimension, quality] of [[1200, 0.82], [960, 0.76], [720, 0.7]]) {
    if (images.reduce((total, data) => total + data.length, 0) <= MAX_ITEM_IMAGE_CHARS) break;
    images = await Promise.all(originals.map((data) => compressImage(data, dimension, quality)));
  }
  if (images.reduce((total, data) => total + data.length, 0) > MAX_ITEM_IMAGE_CHARS) {
    throw new Error("These images are too large to save. Choose another product image.");
  }
  return { imageData: images[0], ...(back ? { backImageData: images[1] } : {}) };
}

export async function cacheProductImage(url: string): Promise<string> {
  return (await cacheProductImages({ imageUrl: url })).imageData;
}
