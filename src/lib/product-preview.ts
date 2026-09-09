import type { Item } from "./types";
import type { PhotoSide } from "./photo-slots";

type PreviewItem = Pick<Item, "imageUrl" | "imageData" | "backImageUrl" | "backImageData" | "sideImageUrl" | "sideImageData">;
export type ProductPreviewImage = { side: PhotoSide; imageUrl: string; imageData?: string };
export type ProductPreviewImages = { primary: ProductPreviewImage | null; secondary: ProductPreviewImage | null };

function samePhoto(a: ProductPreviewImage, b: ProductPreviewImage): boolean {
  // Cached pixels take precedence over their original listing URL. A cutout
  // and its original can share a URL while containing different actual images.
  if (a.imageData && b.imageData) return a.imageData === b.imageData;
  return !!a.imageUrl && a.imageUrl === b.imageUrl;
}

/** Pair priority is front/back, side/back, then front/side; the first view rests. */
export function getProductPreviewImages(item: PreviewItem): ProductPreviewImages {
  const image = (side: PhotoSide, imageUrl?: string, imageData?: string): ProductPreviewImage | null => {
    const url = imageUrl?.trim() ?? "";
    const data = imageData?.trim() || undefined;
    return url || data ? { side, imageUrl: url, ...(data ? { imageData: data } : {}) } : null;
  };
  const views = {
    front: image("front", item.imageUrl, item.imageData),
    back: image("back", item.backImageUrl, item.backImageData),
    side: image("side", item.sideImageUrl, item.sideImageData),
  };
  const pairs: Array<[PhotoSide, PhotoSide]> = [["front", "back"], ["side", "back"], ["front", "side"]];
  for (const [first, second] of pairs) {
    const primary = views[first];
    const secondary = views[second];
    if (primary && secondary && !samePhoto(primary, secondary)) return { primary, secondary };
  }
  return { primary: views.front ?? views.side ?? views.back, secondary: null };
}
