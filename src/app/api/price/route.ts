import { NextResponse } from "next/server";
import { fetchProductPrice, ProductImportError } from "@/lib/server/product";
import { SafeFetchError } from "@/lib/server/safe-fetch";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 10000;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new SafeFetchError("The request is too large.", "TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new SafeFetchError("Send a product URL to check.", "INVALID_URL");
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new SafeFetchError("The request is too large.", "TOO_LARGE");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return JSON.parse(text); } catch { throw new SafeFetchError("Send a product URL to check.", "INVALID_URL"); }
}

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const url = body && typeof body === "object" && "url" in body ? body.url : undefined;
    if (typeof url !== "string" || !url.trim() || url.length > 8192) return json({ error: "Enter a valid product URL.", code: "INVALID_URL" }, 400);
    return json(await fetchProductPrice(url));
  } catch (error) {
    if (error instanceof ProductImportError) return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof SafeFetchError) {
      const status = error.code === "INVALID_URL" || error.code === "BLOCKED_URL" ? 400 : error.code === "TIMEOUT" ? 504 : error.code === "TOO_LARGE" ? 413 : 502;
      return json({ error: error.message, code: error.code }, status);
    }
    return json({ error: "This price could not be checked. Try again later.", code: "PRICE_FETCH_FAILED" }, 502);
  }
}
