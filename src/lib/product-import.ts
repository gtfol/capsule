import type { ProductImport } from "./server/product";

/** Browser handoffs and pasted links use the same import endpoint and validation. */
export function normalizeProductUrl(value: string): string {
  if (value.length > 8192) throw new Error("This product link is too long.");
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new Error("Paste a full product URL, starting with https://."); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Paste a full product URL, starting with https://.");
  }
  if (url.href.length > 8192) throw new Error("This product link is too long.");
  return url.href;
}

export async function fetchProductImport(value: string, options: { signal: AbortSignal; online: boolean; fetcher?: typeof fetch }): Promise<ProductImport> {
  const url = normalizeProductUrl(value);
  if (!options.online) throw new Error("Connect to the internet to fetch a product link.");
  options.signal.throwIfAborted();
  const response = await (options.fetcher ?? fetch)("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(35_000)]),
  });
  const data = await response.json();
  options.signal.throwIfAborted();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "This page could not be imported. Try another product link.");
  return data;
}
