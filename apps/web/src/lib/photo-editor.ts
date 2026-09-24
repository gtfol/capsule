import { cacheProductImages, imageSource } from "./images";
import type { PhotoSlots } from "./photo-slots";
import type { Item } from "./types";

export type PieceImages = Pick<Item, "imageUrl" | "imageData" | "backImageUrl" | "backImageData" | "sideImageUrl" | "sideImageData">;
export type PhotoChoice = { id: string; imageUrl: string; imageData?: string; cutout?: string; useCutout?: boolean };
export type PhotoState = PhotoSlots & { choices: PhotoChoice[] };
export function initialPhotos(item: PieceImages, images: string[], uploadedImages: string[]): PhotoState {
  if (uploadedImages.length) {
    const choices = [...new Set(uploadedImages)].map((imageData, index) => ({ id: `upload-${index}`, imageUrl: "", imageData }));
    return { choices, frontId: choices[0].id, backId: choices[1]?.id ?? null, sideId: choices[2]?.id ?? null };
  }
  const choices: PhotoChoice[] = [];
  if (item.imageData || item.imageUrl) choices.push({ id: "front", imageUrl: item.imageUrl, imageData: item.imageData });
  const back = { id: "back", imageUrl: item.backImageUrl ?? "", imageData: item.backImageData };
  const hasBack = !!(back.imageData || back.imageUrl) && (!choices[0] || imageSource(back) !== imageSource(choices[0]));
  if (hasBack) choices.push(back);
  const side = { id: "side", imageUrl: item.sideImageUrl ?? "", imageData: item.sideImageData };
  const hasSide = !!(side.imageData || side.imageUrl) && !choices.some((choice) => imageSource(choice) === imageSource(side));
  if (hasSide) choices.push(side);
  for (const imageUrl of images) {
    if (imageUrl && !choices.some((choice) => choice.imageUrl === imageUrl)) choices.push({ id: `gallery-${choices.length}`, imageUrl });
  }
  return { choices: choices.slice(0, 24), frontId: choices[0]?.id ?? "", backId: hasBack ? "back" : null, sideId: hasSide ? "side" : null };
}
export const chosenImage = (choice: PhotoChoice) => ({ imageUrl: choice.imageUrl, imageData: choice.useCutout ? choice.cutout : choice.imageData });


/** Explicit undefined values clear removed optional views on the saved record. */
export async function savePhotoState(photos: PhotoState): Promise<PieceImages> {
  const front = photos.choices.find((choice) => choice.id === photos.frontId);
  const back = photos.backId !== photos.frontId ? photos.choices.find((choice) => choice.id === photos.backId) : undefined;
  const side = photos.sideId !== photos.frontId && photos.sideId !== photos.backId ? photos.choices.find((choice) => choice.id === photos.sideId) : undefined;
  if (!front) throw new Error("Choose a front photo for this piece.");
  const { imageData, backImageData, sideImageData } = await cacheProductImages(chosenImage(front), back ? chosenImage(back) : undefined, side ? chosenImage(side) : undefined);
  return { imageUrl: front.imageUrl, imageData, backImageUrl: back?.imageUrl, backImageData, sideImageUrl: side?.imageUrl, sideImageData };
}
