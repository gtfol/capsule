import assert from "node:assert/strict";
import test from "node:test";
import { fetchProductImport, normalizeProductUrl } from "../src/lib/product-import";

const productUrl = "https://shop.example/products/coat?variant=123&size=M#navy";
const product = {
  item: { name: "Coat", brand: "Studio", category: "jackets", price: "90", currency: "USD", imageUrl: "https://shop.example/coat.jpg", purchaseUrl: productUrl },
  images: ["https://shop.example/coat.jpg"],
  priceQuote: { price: "90", currency: "USD", source_url: productUrl },
};

test("product handoffs preserve variant parameters and fragments", () => {
  assert.equal(normalizeProductUrl(`  ${productUrl}  `), productUrl);
});

test("product imports reject malformed, privileged, credentialed and oversized links before fetching", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return Response.json(product); }) as typeof fetch;
  for (const value of ["", "not a URL", "//shop.example/piece", "chrome://newtab", "brave://settings", "file:///piece.jpg", "javascript:alert(1)", "data:text/html,hi", "https://user:secret@shop.example/product", `https://shop.example/${"x".repeat(8192)}`, `https://shop.example/${"é".repeat(1400)}`]) {
    await assert.rejects(fetchProductImport(value, { signal: new AbortController().signal, online: true, fetcher }));
  }
  assert.equal(calls, 0);
});

test("handoffs use the existing import API and preserve fetched details and the first price observation", async () => {
  const data = await fetchProductImport(productUrl, {
    signal: new AbortController().signal,
    online: true,
    fetcher: (async (input, init) => {
      assert.equal(input, "/api/import");
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("Content-Type"), "application/json");
      assert.deepEqual(JSON.parse(init?.body as string), { url: productUrl });
      assert.ok(init?.signal);
      return Response.json(product);
    }) as typeof fetch,
  });
  assert.deepEqual(data, product);
});

test("offline or already canceled imports do not make a request", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return Response.json(product); }) as typeof fetch;
  await assert.rejects(fetchProductImport(productUrl, { signal: new AbortController().signal, online: false, fetcher }), /Connect to the internet/);
  const canceled = new AbortController();
  canceled.abort();
  await assert.rejects(fetchProductImport(productUrl, { signal: canceled.signal, online: true, fetcher }), { name: "AbortError" });
  assert.equal(calls, 0);
});

test("failed fetches surface the import error for retry without returning a draft", async () => {
  await assert.rejects(fetchProductImport(productUrl, {
    signal: new AbortController().signal, online: true,
    fetcher: (async () => Response.json({ error: "This shop could not be reached." }, { status: 502 })) as typeof fetch,
  }), /This shop could not be reached/);
});

test("a canceled import cannot deliver a late response to another editor", async () => {
  const canceled = new AbortController();
  await assert.rejects(fetchProductImport(productUrl, {
    signal: canceled.signal, online: true,
    fetcher: (async () => { canceled.abort(); return Response.json(product); }) as typeof fetch,
  }), { name: "AbortError" });
});
