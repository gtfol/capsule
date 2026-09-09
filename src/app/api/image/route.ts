import { NextResponse } from "next/server";
import { rasterImageType, safeFetch, SafeFetchError } from "@/lib/server/safe-fetch";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "An image URL is required." }, { status: 400 });
  try {
    const response = await safeFetch(url, { maxBytes: 8 * 1024 * 1024, timeoutMs: 15000, accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9" });
    if (response.status < 200 || response.status >= 300) return NextResponse.json({ error: "The store did not return this image. Try another product photo." }, { status: 422 });
    const actualType = rasterImageType(response.body);
    const declaredType = response.contentType === "image/jpg" ? "image/jpeg" : response.contentType;
    if (!actualType || declaredType && declaredType !== actualType && declaredType !== "application/octet-stream") {
      return NextResponse.json({ error: "This URL does not return a supported product image." }, { status: 415 });
    }
    return new Response(new Uint8Array(response.body), {
      headers: {
        "Content-Type": actualType,
        "Content-Length": String(response.body.length),
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof SafeFetchError) {
      const status = error.code === "INVALID_URL" || error.code === "BLOCKED_URL" ? 400 : error.code === "TOO_LARGE" ? 413 : error.code === "TIMEOUT" ? 504 : 502;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json({ error: "This image could not be loaded. Try another product photo." }, { status: 502 });
  }
}
