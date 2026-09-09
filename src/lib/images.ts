"use client";
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
export async function cacheProductImage(url: string): Promise<string> {
  const response = await fetch(`/api/image?url=${encodeURIComponent(url)}`);
  if (!response.ok) throw new Error("The product image could not be saved. Try another image from this page.");
  const data = await compressImage(await response.blob());
  if (data.length > 2_800_000) throw new Error("This image is too large. Choose another product image.");
  return data;
}
