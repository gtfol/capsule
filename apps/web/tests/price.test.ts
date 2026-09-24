import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../src/app/api/price/route";
import { extractProduct, extractProductPrice, fetchProductPrice, importProduct, parseProductPrice, ProductImportError } from "../src/lib/server/product";
import { SafeFetchError, type safeFetch, type SafeFetchResult } from "../src/lib/server/safe-fetch";

const pageUrl = "https://store.example.com/products/jacket";
const jsonPage = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const productPage = (offers: unknown) => jsonPage({ "@type": "Product", offers });
const page = (html: string, overrides: Partial<SafeFetchResult> = {}): SafeFetchResult => ({ url: pageUrl, status: 200, headers: {}, body: Buffer.from(html), contentType: "text/html", ...overrides });

test("price extraction works without a product name or photo and preserves its observed timestamp", () => {
  const quote = extractProductPrice(productPage({ price: "129.00", priceCurrency: "usd" }), pageUrl, undefined, `${pageUrl}?campaign=one#photo`, 1234);
  assert.deepEqual(quote, { price: "129.00", currency: "USD", source_url: `${pageUrl}?campaign=one`, fetched_at: 1234 });
  assert.throws(() => extractProduct(productPage({ price: "129.00", priceCurrency: "USD" }), pageUrl), /photo/);
});

test("strict amounts support retailer separators without turning missing or malformed values into zero", () => {
  for (const [input, expected] of [["1,234.56", "1234.56"], ["1.234,56", "1234.56"], ["1 234,50", "1234.50"], ["1\u202f234.50", "1234.50"], ["1'234.50", "1234.50"], ["49,95", "49.95"], ["0.00", "0.00"], [0, "0"], ["001.20", "1.20"]] as const) {
    assert.equal(parseProductPrice(input), expected);
  }
  for (const input of [undefined, null, "", "  ", false, [], {}, -1, Infinity, NaN, "-9", "1e3", "$49.00", "49–99", "12,34,56", "10000000000000000", "1.000,000"]) assert.equal(parseProductPrice(input), undefined, String(input));
  for (const offers of [{ price: "", priceCurrency: "USD" }, { price: 12 }, { price: 12, priceCurrency: "$" }, { price: 12, priceCurrency: "US dollars" }]) assert.equal(extractProductPrice(productPage(offers), pageUrl), undefined);
});

test("current sale prices win over compare-at or strikethrough specifications", () => {
  assert.equal(extractProductPrice(productPage({ price: "80", priceCurrency: "EUR", priceSpecification: { price: "140", priceCurrency: "EUR", priceType: "https://schema.org/StrikethroughPrice" } }), pageUrl)?.price, "80");
  const specifications = [{ price: "140", priceCurrency: "EUR", priceType: "https://schema.org/ListPrice" }, { price: "80", priceCurrency: "EUR", priceType: "https://schema.org/SalePrice" }];
  assert.equal(extractProductPrice(productPage({ priceSpecification: specifications }), pageUrl)?.price, "80");
  assert.equal(extractProductPrice(productPage({ priceSpecification: specifications.slice(0, 1) }), pageUrl), undefined);
});

test("offers from unrelated products and conflicting unselected variants are not used", () => {
  const data = [
    { "@type": "Product", url: "https://store.example.com/products/socks", offers: { price: "5", priceCurrency: "USD" } },
    { "@type": "Product", url: pageUrl, offers: { price: "100", priceCurrency: "USD" } },
  ];
  assert.equal(extractProductPrice(jsonPage(data), pageUrl)?.price, "100");
  assert.equal(extractProductPrice(jsonPage(data.slice(0, 1)), pageUrl), undefined);
  assert.equal(extractProductPrice(productPage([{ price: "40", priceCurrency: "USD" }, { price: "50", priceCurrency: "USD" }]), pageUrl), undefined);
  assert.equal(extractProductPrice(productPage([{ price: "40", priceCurrency: "USD" }, { price: "40", priceCurrency: "EUR" }]), pageUrl), undefined);
  assert.equal(extractProductPrice(productPage({ url: "https://other.example.com/unrelated", price: "5", priceCurrency: "USD" }), pageUrl), undefined);
});

test("variant URLs and graph references identify the current offer", () => {
  const url = `${pageUrl}?variant=two&utm_source=test`;
  const graph = { "@graph": [
    { "@type": "Offer", "@id": "#first", url: `${pageUrl}?variant=one`, price: "40", priceCurrency: "USD" },
    { "@type": "Offer", "@id": "#second", url: `${pageUrl}?variant=two`, price: "60", priceCurrency: "USD" },
    { "@type": "Product", "@id": "#product", offers: [{ "@id": "#first" }, { "@id": "#second" }] },
  ] };
  assert.equal(extractProductPrice(jsonPage(graph), url)?.price, "60");
  assert.equal(extractProductPrice(jsonPage(graph), `${pageUrl}?variant=unknown`), undefined);
  const group = { "@type": "ProductGroup", hasVariant: [{ "@type": "Product", offers: { price: "70", priceCurrency: "GBP" } }] };
  assert.equal(extractProductPrice(jsonPage(group), pageUrl)?.price, "70");
});

test("base product links use an unambiguous advertised default-variant offer", () => {
  // MUJI's product page publishes one default variant URL without a product URL.
  const offer = { "@type": "Offer", price: 19.9, priceCurrency: "USD", url: `${pageUrl}?variant=one` };
  assert.equal(extractProductPrice(productPage(offer), pageUrl)?.price, "19.9");
  assert.equal(extractProductPrice(productPage(offer), `${pageUrl}?variant=two`), undefined);
  assert.equal(extractProductPrice(productPage([offer, { ...offer, url: `${pageUrl}?variant=two` }]), pageUrl)?.price, "19.9");
  assert.equal(extractProductPrice(productPage([offer, { ...offer, price: 25, url: `${pageUrl}?variant=two` }]), pageUrl), undefined);
  // A canonical product URL may omit the selector while its offer includes it.
  assert.equal(extractProductPrice(jsonPage({ "@type": "Product", url: pageUrl, offers: offer }), `${pageUrl}?variant=one`)?.price, "19.9");
});

test("microdata prices inside related product cards cannot become the listing's price", () => {
  const html = `<body><div itemscope itemtype="https://schema.org/Product" itemid="https://store.example.com/products/socks">
    <meta itemprop="price" content="5"><meta itemprop="priceCurrency" content="USD"></div></body>`;
  assert.equal(extractProductPrice(html, pageUrl), undefined);
  assert.equal(extractProductPrice(html.replace("https://store.example.com/products/socks", pageUrl), pageUrl)?.price, "5");
});

test("Shopify fallback uses a selected variant's current price and requires a currency", () => {
  const shopify = { product: { variants: [{ id: 1, price: "120", compare_at_price: "200" }, { id: 2, price: "80", compare_at_price: "180" }] } };
  const html = '<meta property="product:price:currency" content="USD">';
  assert.equal(extractProductPrice(html, `${pageUrl}?variant=2`, shopify)?.price, "80");
  assert.equal(extractProductPrice(html, `${pageUrl}?variant=missing`, shopify), undefined);
  assert.equal(extractProductPrice("", pageUrl, shopify), undefined);
});

test("price fetch uses the protected transport with body/time limits and retains the requested source after redirects", async () => {
  const fetcher: typeof safeFetch = async (input, options) => {
    assert.equal(String(input), `${pageUrl}?tracking=yes`);
    assert.equal(options?.maxBytes, 5 * 1024 * 1024);
    assert.equal(options?.timeoutMs, 16000);
    return page(productPage({ price: "90", priceCurrency: "USD" }), { url: "https://other.example.com/new-listing" });
  };
  const start = Date.now();
  const quote = await fetchProductPrice(`${pageUrl}?tracking=yes#details`, fetcher);
  assert.equal(quote.price, "90");
  assert.equal(quote.source_url, `${pageUrl}?tracking=yes`);
  assert.ok(quote.fetched_at >= start && quote.fetched_at <= Date.now());
});

test("missing quotes, blocked pages, unavailable listings, and transport failures are actionable errors", async () => {
  for (const [response, code] of [
    [page("<title>No price</title>"), "NO_PRICE"],
    [page("<title>Just a moment...</title>"), "BLOCKED_SITE"],
    [page("", { status: 404 }), "NOT_FOUND"],
    [page("", { status: 410 }), "NOT_FOUND"],
    [page("", { status: 403 }), "BLOCKED_SITE"],
    [page("", { status: 500 }), "INVALID_PAGE"],
    [page("", { contentType: "application/pdf" }), "INVALID_PAGE"],
  ] as const) {
    await assert.rejects(fetchProductPrice(pageUrl, async () => response), (error) => error instanceof ProductImportError && error.code === code);
  }
  await assert.rejects(fetchProductPrice(pageUrl, async () => { throw new SafeFetchError("Too slow", "TIMEOUT"); }), (error) => error instanceof SafeFetchError && error.code === "TIMEOUT");
});

test("an import includes the first quote without adding another fetch and keeps its requested source", async () => {
  let calls = 0;
  const requested = "https://store.example.com/item/old";
  const imported = await importProduct(requested, async () => {
    calls++;
    return page(jsonPage({ "@type": "Product", name: "Jacket", image: "/photo.jpg", offers: { price: "95.00", priceCurrency: "USD" } }), { url: "https://store.example.com/item/new" });
  });
  assert.equal(calls, 1);
  assert.equal(imported.item.name, "Jacket");
  assert.equal(imported.images.length, 1);
  assert.equal(imported.priceQuote?.source_url, requested);
  assert.equal(imported.priceQuote?.price, "95.00");
});

test("Shopify price fallback stays bounded and does not require gallery or name metadata", async () => {
  const calls: string[] = [];
  const quote = await fetchProductPrice(pageUrl, async (url, options) => {
    calls.push(String(url));
    if (calls.length === 1) return page('<meta property="product:price:currency" content="USD">');
    assert.equal(options?.maxBytes, 1024 * 1024);
    assert.equal(options?.timeoutMs, 6500);
    return page(JSON.stringify({ product: { variants: [{ price: "19.00" }] } }), { contentType: "application/json" });
  });
  assert.deepEqual(calls, [pageUrl, `${pageUrl}.json`]);
  assert.equal(quote.price, "19.00");
});

test("price endpoint rejects invalid and private links with uncached errors", async () => {
  for (const body of ["{broken", "null", "[]", JSON.stringify({ url: "" }), JSON.stringify({ url: 42 }), JSON.stringify({ url: "http://127.0.0.1/private" }), JSON.stringify({ url: "http://localhost/private" }), JSON.stringify({ url: "https://user:pass@store.example.com" }), JSON.stringify({ url: "a".repeat(8193) })]) {
    const response = await POST(new Request("https://capsule.example.com/api/price", { method: "POST", body }));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok((await response.json()).code);
  }
});

test("price request limits count streamed bytes and cancel an oversized body", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode("é".repeat(5001))); },
    cancel() { cancelled = true; },
  });
  const response = await POST(new Request("https://capsule.example.com/api/price", { method: "POST", body: stream, duplex: "half" } as RequestInit));
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const knownLength = await POST(new Request("https://capsule.example.com/api/price", { method: "POST", body: "{}", headers: { "content-length": "10001" } }));
  assert.equal(knownLength.status, 413);
});
