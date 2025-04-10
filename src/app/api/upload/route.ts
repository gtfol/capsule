import { put, list } from "@vercel/blob";
import { NextResponse } from "next/server";

const VALID_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

function hasValidImageExtension(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const extension = pathname.toLowerCase().split(".").pop();
    return extension
      ? VALID_IMAGE_EXTENSIONS.some((ext) => ext.includes(extension))
      : false;
  } catch (error) {
    // If URL parsing fails, fall back to the simple string check
    const extension = url.toLowerCase().split(".").pop();
    return extension
      ? VALID_IMAGE_EXTENSIONS.some((ext) => ext.includes(extension))
      : false;
  }
}

async function getHashedFilename(url: string): Promise<string> {
  try {
    // Get the extension from the URL pathname
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const extension = pathname.toLowerCase().split(".").pop() || "jpg";

    // Create a hash of the URL using the Web Crypto API
    const encoder = new TextEncoder();
    const data = encoder.encode(url);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);

    // Convert the hash to a base64 string and make it URL-safe
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashBase64 = btoa(String.fromCharCode(...hashArray))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    // Use the first 12 characters of the hash for a reasonable filename length
    return `capsule/${hashBase64.slice(0, 12)}.${extension}`;
  } catch (error) {
    // Fallback to the original URL if parsing fails
    const extension = url.toLowerCase().split(".").pop() || "jpg";
    const encoder = new TextEncoder();
    const data = encoder.encode(url);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashBase64 = btoa(String.fromCharCode(...hashArray))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return `capsule/${hashBase64.slice(0, 12)}.${extension}`;
  }
}

async function downloadImage(url: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error("Failed to fetch image");

  const contentType = response.headers.get("content-type");
  if (!contentType?.startsWith("image/")) {
    throw new Error("URL does not point to a valid image");
  }

  const blob = await response.blob();
  const filename = await getHashedFilename(url);

  return { blob, filename };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const imageUrl = formData.get("imageUrl") as string | null;

    if (!file && !imageUrl) {
      return NextResponse.json(
        { error: "Either file or imageUrl is required" },
        { status: 400 }
      );
    }

    let uploadFile: File;
    let filename: string;

    if (imageUrl) {
      // Handle URL upload
      if (!hasValidImageExtension(imageUrl)) {
        return NextResponse.json(
          {
            error: "Invalid image format. Please use JPG, JPEG, PNG, WEBP, or GIF files.",
          },
          { status: 400 }
        );
      }

      const { blob, filename: hashedFilename } = await downloadImage(imageUrl);
      uploadFile = new File([blob], hashedFilename, { type: blob.type });
      filename = hashedFilename;
    } else {
      uploadFile = file!;
      if (!hasValidImageExtension(uploadFile.name)) {
        return NextResponse.json(
          {
            error: "Invalid image format. Please use JPG, JPEG, PNG, WEBP, or GIF files.",
          },
          { status: 400 }
        );
      }
      filename = `capsule/${uploadFile.name}`;
    }

    // Check if file already exists
    const { blobs } = await list();
    const existingBlob = blobs.find(blob => blob.pathname === filename);
    
    if (existingBlob) {
      // If file exists, return its URL
      return NextResponse.json({ url: existingBlob.url });
    }

    // If file doesn't exist, upload it
    const { url } = await put(filename, uploadFile, {
      access: "public",
      addRandomSuffix: !imageUrl, // Only add random suffix for direct file uploads
    });

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Error handling upload:", error);
    return NextResponse.json(
      { error: "Failed to process upload" },
      { status: 500 }
    );
  }
}
