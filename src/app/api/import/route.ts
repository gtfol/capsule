import { NextResponse } from "next/server";
import { importProduct, ProductImportError } from "@/lib/server/product";
import { SafeFetchError } from "@/lib/server/safe-fetch";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 10000) return NextResponse.json({ error: "The link is too long.", code: "INVALID_URL" }, { status: 400 });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Send a product URL to import.", code: "INVALID_URL" }, { status: 400 }); }
    const url = body && typeof body === "object" && "url" in body ? body.url : undefined;
    if (typeof url !== "string" || !url.trim() || url.length > 8192) return NextResponse.json({ error: "Enter a valid product URL.", code: "INVALID_URL" }, { status: 400 });
    return NextResponse.json(await importProduct(url), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProductImportError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof SafeFetchError) {
      const status = error.code === "INVALID_URL" || error.code === "BLOCKED_URL" ? 400 : error.code === "TIMEOUT" ? 504 : error.code === "TOO_LARGE" ? 413 : 502;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json({ error: "This product could not be imported. Try another product link.", code: "IMPORT_FAILED" }, { status: 502 });
  }
}
