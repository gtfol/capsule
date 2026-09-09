import assert from "node:assert/strict";
import test from "node:test";
import { extractProduct, inferCategory, ProductImportError } from "../src/lib/server/product";

const pageUrl = "https://store.example.com/products/work-jacket";
const jsonPage = (data: unknown, extra = "") => `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script>${extra}</head><body></body></html>`;

test("extracts a structured product and decodes description without markup", () => {
  const imported = extractProduct(jsonPage({
    "@type": "Product", name: "Canvas work jacket", brand: { "@type": "Brand", name: "Factory" },
    image: ["/images/jacket-front.jpg", "/images/jacket-back.jpg"],
    description: "<p>Cotton &amp; canvas.</p>", offers: { price: "120.00", priceCurrency: "USD" },
  }), pageUrl);
  assert.deepEqual(imported.item, {
    name: "Canvas work jacket", brand: "Factory", price: "120.00", currency: "USD",
    description: "Cotton & canvas.", purchaseUrl: pageUrl,
    imageUrl: "https://store.example.com/images/jacket-front.jpg", category: "jackets", size: "", color: "",
  });
  assert.equal(imported.images.length, 2);
});

test("reads graph references, ProductGroup data, and variant offers", () => {
  const imported = extractProduct(jsonPage({ "@graph": [
    { "@type": "Brand", "@id": "#brand", name: "Small Label" },
    { "@type": "Offer", "@id": "#offer", price: 99, priceCurrency: "EUR" },
    { "@type": "ProductGroup", name: "Cotton trousers", brand: { "@id": "#brand" }, image: "/trousers.jpg", hasVariant: [
      { "@type": "Product", name: "Cotton trousers / black", offers: { "@id": "#offer" } },
    ] },
  ] }), pageUrl);
  assert.equal(imported.item.name, "Cotton trousers / black");
  assert.equal(imported.item.brand, "Small Label");
  assert.equal(imported.item.price, "99");
  assert.equal(imported.item.category, "bottoms");
});

test("prefers an explicitly identified packshot and keeps the alternate photos", () => {
  const { images } = extractProduct(jsonPage({ "@type": "Product", name: "T-shirt", image: [
    { "@type": "ImageObject", url: "/model-front.jpg", caption: "On model" },
    { "@type": "ImageObject", contentUrl: "/tee.jpg", caption: "Product only packshot" },
    "/tee-back.jpg",
  ] }), pageUrl);
  assert.equal(images[0], "https://store.example.com/tee.jpg");
  assert.equal(images.length, 3);
});

test("falls back to OpenGraph despite malformed JSON-LD", () => {
  const { item } = extractProduct(`<script type="application/ld+json">{broken json}</script>
    <meta property="og:title" content="Leather shoes">
    <meta property="og:image" content="//images.example.com/shoes.jpg">
    <meta property="product:price:amount" content="180">
    <meta property="product:price:currency" content="usd">`, pageUrl);
  assert.equal(item.name, "Leather shoes");
  assert.equal(item.imageUrl, "https://images.example.com/shoes.jpg");
  assert.equal(item.price, "180");
  assert.equal(item.currency, "USD");
  assert.equal(item.category, "shoes");
});

test("uses public Shopify metadata when the HTML is empty", () => {
  const { item } = extractProduct("<title>Store</title>", pageUrl, { product: {
    title: "Nylon backpack", vendor: "Studio", product_type: "Bags", body_html: "<p>Two pockets.</p>",
    variants: [{ price: "65.50" }], images: [{ src: "https://cdn.example.com/bag.jpg", alt: "Backpack" }],
  } });
  assert.equal(item.name, "Nylon backpack");
  assert.equal(item.brand, "Studio");
  assert.equal(item.price, "65.50");
  assert.equal(item.category, "accessories");
});

test("chooses a large gallery source and discards decorative images", () => {
  const { images } = extractProduct(`<title>Wool jumper</title><div class="product-gallery">
    <img src="/logo.jpg" alt="Brand logo">
    <img src="/small.jpg" srcset="/small.jpg 200w, /large.jpg 1200w" alt="Wool jumper">
    <img src="/swatch.jpg" width="40" height="40">
  </div>`, pageUrl);
  assert.deepEqual(images, ["https://store.example.com/large.jpg"]);
});

test("structured product images exclude recommendation blocks and unrelated OpenGraph images", () => {
  const { images } = extractProduct(jsonPage({ "@type": "Product", name: "Cotton shirt", image: ["/shirt-front.jpg", "/shirt-back.jpg"] },
    '<meta property="og:image" content="/campaign-luggage.jpg">') + `
    <div class="product-gallery"><img src="/another-product.jpg"></div>
    <div class="product-recommendations"><div class="product-gallery"><img src="/socks.jpg"></div></div>`, pageUrl);
  assert.deepEqual(images, ["https://store.example.com/shirt-front.jpg", "https://store.example.com/shirt-back.jpg"]);
});

test("Shopify's complete full-size gallery replaces the HTML preview gallery", () => {
  const { images } = extractProduct(jsonPage({ "@type": "Product", name: "Cotton shirt", brand: "Brand", offers: { price: "20", priceCurrency: "USD" }, image: "/preview.jpg" }), pageUrl, { product: {
    images: [
      { src: "https://cdn.shopify.com/s/files/1/001/files/shirt-model.jpg?width=480&v=1", alt: "Shirt on model" },
      { src: "https://cdn.shopify.com/s/files/1/001/files/shirt-flat.jpg?v=1", alt: "Shirt packshot" },
      { src: "https://cdn.shopify.com/s/files/1/001/files/shirt-back.jpg?v=1", alt: "Shirt back" },
    ],
  } });
  assert.equal(images[0], "https://cdn.shopify.com/s/files/1/001/files/shirt-flat.jpg?v=1");
  assert.equal(images.length, 3);
  assert.ok(images.every((url) => !url.includes("preview") && !url.includes("width=")));
});

test("DOM-only fallback skips related products and generic product cards", () => {
  const { images } = extractProduct(`<title>Cotton shirt</title>
    <div class="product-gallery"><img src="/shirt.jpg"></div>
    <div class="related-products"><div class="product-gallery"><img src="/socks.jpg"></div></div>
    <div class="product-card"><img src="/luggage.jpg"></div>`, pageUrl);
  assert.deepEqual(images, ["https://store.example.com/shirt.jpg"]);
});

test("rejects private image URLs, data URLs, and SVGs rather than creating an empty draft", () => {
  for (const image of ["http://127.0.0.1/item.png", "http://[::1]/item.png", "data:image/png;base64,AAAA", "/image.svg"]) {
    assert.throws(() => extractProduct(jsonPage({ "@type": "Product", name: "Tee", image }), pageUrl),
      (error: unknown) => error instanceof ProductImportError && error.code === "NO_IMAGE");
  }
});

test("returns an actionable error for bot-blocked pages", () => {
  assert.throws(() => extractProduct("<title>Just a moment...</title><h1>Verify you are human</h1>", pageUrl),
    (error: unknown) => error instanceof ProductImportError && error.code === "BLOCKED_SITE");
});

test("categorizes from garment nouns rather than incidental word fragments", () => {
  assert.equal(inferCategory("Canvas jacket"), "jackets");
  assert.equal(inferCategory("Denim shirt"), "tops");
  assert.equal(inferCategory("Denim jeans"), "bottoms");
  assert.equal(inferCategory("Oxford shirt"), "tops");
  assert.equal(inferCategory("Oxford shoes"), "shoes");
  assert.equal(inferCategory("Black cap"), "accessories");
  assert.equal(inferCategory("Classic T-shirt"), "tops");
});
