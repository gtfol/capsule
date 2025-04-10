import { put } from "@vercel/blob";

const VALID_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

function hasValidImageExtension(url: string): boolean {
  const extension = url.toLowerCase().split(".").pop();
  return extension
    ? VALID_IMAGE_EXTENSIONS.some((ext) => ext.includes(extension))
    : false;
}

async function downloadImage(
  url: string
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error("Failed to fetch image");

  const contentType = response.headers.get("content-type");
  if (!contentType?.startsWith("image/")) {
    throw new Error("URL does not point to a valid image");
  }

  const blob = await response.blob();
  const filename = new URL(url).pathname.split("/").pop() || "image.jpg";

  return { blob, filename };
}

export async function uploadImage(file: File) {
  try {
    const filename = `capsule/${file.name}`;
    const { url } = await put(filename, file, {
      access: "public",
      addRandomSuffix: true,
      token: import.meta.env.VITE_BLOB_READ_WRITE_TOKEN,
    });

    return url;
  } catch (error) {
    console.error("Error uploading image:", error);
    throw error;
  }
}

export async function uploadImageFromUrl(imageUrl: string) {
  try {
    if (!hasValidImageExtension(imageUrl)) {
      throw new Error(
        "Invalid image format. Please use JPG, JPEG, PNG, WEBP, or GIF files."
      );
    }

    const { blob, filename } = await downloadImage(imageUrl);
    const file = new File([blob], filename, { type: blob.type });

    return await uploadImage(file);
  } catch (error) {
    console.error("Error uploading image from URL:", error);
    throw error;
  }
}
