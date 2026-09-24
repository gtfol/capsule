import sharp from "sharp";
import { MAX_ITEM_IMAGE_CHARS } from "../image-limits";
import type { Item } from "../types";
import { parseRaster } from "./render";
import { IntegrationError } from "./integration-tokens";

export const PHOTO_FIELDS = [
  ["imageUrl", "imageData"],
  ["backImageUrl", "backImageData"],
  ["sideImageUrl", "sideImageData"],
] as const;

// Decode and re-encode outside the account lock. Strip metadata and bound both
// decoded pixels and stored bytes; untrusted files never become public assets.
export async function prepareIntegrationPhotos(input: Partial<Item>): Promise<Partial<Item>> {
  const fields: Partial<Item> = {};
  for (const [url, data] of PHOTO_FIELDS) {
    if (input[url] !== undefined && input[data] !== undefined) {
      throw new IntegrationError("Send either an image URL or image data for each view, not both.");
    }
    if (input[url] !== undefined) {
      fields[url] = input[url];
      fields[data] = "";
    } else if (input[data] !== undefined) {
      fields[url] = "";
      fields[data] = "";
      if (input[data]) {
        try {
          const raster = parseRaster(input[data]);
          const bytes = await sharp(raster.bytes, { limitInputPixels: 25_000_000, failOn: "warning" })
            .rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 85 }).toBuffer();
          fields[data] = `data:image/webp;base64,${bytes.toString("base64")}`;
        } catch { throw new IntegrationError("Upload a valid JPEG, PNG, or WebP under 1.5 MB and 25 megapixels."); }
      }
    }
  }
  if (PHOTO_FIELDS.reduce((size, [,data]) => size + (fields[data]?.length ?? 0), 0) > MAX_ITEM_IMAGE_CHARS) {
    throw new IntegrationError("The combined photos are too large. Upload smaller images.");
  }
  return fields;
}
