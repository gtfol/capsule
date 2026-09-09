import * as cheerio from "cheerio";
import { safeFetch, validatePublicUrl } from "./safe-fetch";

export type ProductCategory = "tops" | "jackets" | "bottoms" | "accessories" | "shoes";
export type ProductDraft = {
  name: string;
  brand: string;
  price: string;
  currency: string;
  description: string;
  purchaseUrl: string;
  imageUrl: string;
  category: ProductCategory;
  size: string;
  color: string;
};
export type ProductPriceQuote = { price: string; currency: string; source_url: string; fetched_at: number };
export type ProductImport = { item: ProductDraft; images: string[]; priceQuote?: ProductPriceQuote };

export class ProductImportError extends Error {
  constructor(message: string, public readonly code: "BLOCKED_SITE" | "NO_IMAGE" | "NOT_FOUND" | "INVALID_PAGE" | "NO_PRICE", public readonly status: number = 422) {
    super(message);
    this.name = "ProductImportError";
  }
}

type Data = Record<string, unknown>;
const object = (value: unknown): Data => value && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
const scalar = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const clean = (value: unknown, maxLength = 500): string => cheerio.load(`<body>${scalar(value).slice(0, 30000)}</body>`)("body").text().replace(/\s+/g, " ").trim().slice(0, maxLength);

function absoluteImage(value: unknown, baseUrl: string): string {
  try {
    const url = validatePublicUrl(new URL(scalar(value), baseUrl));
    if (!scalar(value) || /\.(?:svg|ico)(?:$|\?)/i.test(url.href)) return "";
    // Shopify's metadata often points at a tiny resized preview of the original.
    if (url.hostname === "cdn.shopify.com" || url.pathname.startsWith("/cdn/shop/")) {
      for (const parameter of ["width", "height", "crop"]) url.searchParams.delete(parameter);
    }
    return url.href;
  } catch {
    return "";
  }
}

export function inferCategory(value: string): ProductCategory {
  const text = value.toLowerCase();
  if (/\b(?:sneakers?|shoes?|boots?|sandals?|loafers?|mules?|slippers?|footwear|derbies|oxfords)\b/.test(text)) return "shoes";
  if (/\b(?:jackets?|coats?|parkas?|blazers?|outerwear|anoraks?|windbreakers?|puffers?|shells?|gilets?)\b/.test(text)) return "jackets";
  if (/\b(?:pants?|jeans|trousers?|shorts?|skirts?|bottoms?|leggings?|chinos?|sweatpants?)\b/.test(text)) return "bottoms";
  if (/\b(?:bags?|backpacks?|caps?|hats?|beanies?|scarves|scarfs?|belts?|socks?|gloves?|sunglasses|eyewear|jewel(?:lery|ry)|watches?|wallets?|accessories|necklaces?|rings?)\b/.test(text)) return "accessories";
  return "tops";
}

function jsonNodes($: cheerio.CheerioAPI): Data[] {
  const nodes: Data[] = [];
  const walk = (value: unknown, depth = 0) => {
    if (depth > 24 || nodes.length > 3000) return;
    if (Array.isArray(value)) { value.forEach((entry) => walk(entry, depth + 1)); return; }
    if (!value || typeof value !== "object") return;
    nodes.push(value as Data);
    Object.values(value).forEach((entry) => walk(entry, depth + 1));
  };
  $("script[type='application/ld+json']").each((_, element) => {
    const source = $(element).text().trim();
    if (source.length > 1024 * 1024) return;
    try { walk(JSON.parse(source)); } catch { /* Other page metadata may still be usable. */ }
  });
  return nodes;
}

function hasType(node: Data, type: string): boolean {
  return list(node["@type"]).some((value) => scalar(value).split(/[\/#]/).pop() === type);
}

function pageMatches(value: unknown, pageUrl: string): boolean {
  try {
    const candidate = new URL(scalar(value), pageUrl);
    const page = new URL(pageUrl);
    return !!scalar(value) && candidate.hostname === page.hostname && candidate.pathname.replace(/\/$/, "") === page.pathname.replace(/\/$/, "");
  } catch { return false; }
}

/** Prices are amounts, never arbitrary text with digits stripped out of it. */
export function parseProductPrice(value: unknown): string | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? String(value) : undefined;
  if (typeof value !== "string") return undefined;
  let price = value.trim();
  if (!price || price.length > 40) return undefined;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(price)) price = price.replaceAll(",", "");
  else if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(price)) price = price.replaceAll(".", "").replace(",", ".");
  else if (/^\d{1,3}(?:[ '\u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?$/.test(price)) price = price.replace(/[ '\u00a0\u202f]/g, "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(price)) price = price.replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(price)) return undefined;
  const amount = Number(price);
  return Number.isFinite(amount) && amount >= 0 && amount <= Number.MAX_SAFE_INTEGER ? price.replace(/^0+(?=\d)/, "") : undefined;
}

const priceCurrency = (value: unknown): string | undefined => {
  const currency = scalar(value).toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : undefined;
};

const variantSelectors = ["variant", "sku", "pid", "product_id", "size", "color", "colour"];
const hasVariantSelector = (url: URL) => variantSelectors.some((key) => url.searchParams.has(key));

function exactPageMatches(value: unknown, pageUrl: string): boolean {
  if (!pageMatches(value, pageUrl)) return false;
  const candidate = new URL(scalar(value), pageUrl);
  const page = new URL(pageUrl);
  // Tracking parameters must not decide which size/color variant is priced.
  return variantSelectors.every((key) => candidate.searchParams.get(key) === page.searchParams.get(key));
}

/** A price-only extraction does not require a photo or a product name. */
export function extractProductPrice(html: string, pageUrl: string, shopifyData?: unknown, sourceUrl = pageUrl, fetchedAt = Date.now()): ProductPriceQuote | undefined {
  const $ = cheerio.load(html);
  const productScopes = $("[itemscope][itemtype*='Product']");
  const meta = (...names: string[]) => {
    for (const name of names) {
      const value = $(`meta[property='${name}'], meta[name='${name}'], meta[itemprop='${name}']`).filter((_, element) => {
        const scope = $(element).closest("[itemscope][itemtype*='Product']");
        if (scope.length) {
          const listing = scope.attr("itemid") || scope.find("[itemprop='url']").first().attr("href");
          return listing ? exactPageMatches(listing, pageUrl) : productScopes.length === 1;
        }
        return name.includes(":") || $(element).parents("head").length > 0;
      }).first().attr("content");
      if (value?.trim()) return value.trim();
    }
    return "";
  };
  const nodes = jsonNodes($);
  const references = new Map<string, Data>();
  for (const node of nodes) {
    const id = scalar(node["@id"]);
    if (id && Object.keys(node).length > Object.keys(references.get(id) ?? {}).length) references.set(id, node);
  }
  const resolve = (value: unknown): Data => ({ ...references.get(scalar(object(value)["@id"])), ...object(value) });
  const products = nodes.filter((node) => hasType(node, "Product") || hasType(node, "ProductGroup"));
  const mainEntities = nodes.filter((node) => hasType(node, "WebPage") && (!node.url || pageMatches(node.url, pageUrl)))
    .flatMap((node) => list(node.mainEntity).map(resolve));
  const matchingProducts = products.filter((product) => pageMatches(product.url ?? product["@id"], pageUrl));
  const uniqueProducts = products.filter((product) => !product.isVariantOf && !product.url && !product["@id"]);
  const uniqueGroups = uniqueProducts.filter((product) => hasType(product, "ProductGroup"));
  let product = mainEntities.find((node) => hasType(node, "Product") || hasType(node, "ProductGroup"))
    ?? matchingProducts.find((node) => exactPageMatches(node.url ?? node["@id"], pageUrl))
    ?? matchingProducts.find((node) => !hasVariantSelector(new URL(scalar(node.url ?? node["@id"]), pageUrl)))
    ?? (uniqueGroups.length === 1 ? uniqueGroups[0] : undefined)
    ?? (uniqueProducts.length === 1 ? uniqueProducts[0] : undefined);
  if (product && hasType(product, "ProductGroup")) {
    const variants = list(product.hasVariant).map(resolve);
    const matching = variants.find((variant) => exactPageMatches(variant.url, pageUrl));
    if (matching) product = { ...product, ...matching };
    else if (variants.length === 1) product = { ...product, ...variants[0] };
  }
  const pageCurrency = meta("product:price:currency", "og:price:currency", "priceCurrency");
  const quote = (amount: unknown, currencyValue: unknown): ProductPriceQuote | undefined => {
    const price = parseProductPrice(amount);
    const currency = priceCurrency(currencyValue);
    return price !== undefined && currency ? { price, currency, source_url: validatePublicUrl(sourceUrl).href, fetched_at: fetchedAt } : undefined;
  };
  const currentSpecification = (entry: Data) => !/ListPrice|MSRP|StrikethroughPrice|RegularPrice|InvoicePrice/i.test(scalar(entry.priceType));
  const fromOffer = (offer: Data): ProductPriceQuote | undefined => {
    if (!currentSpecification(offer)) return undefined;
    const direct = quote(offer.price ?? (hasType(offer, "AggregateOffer") ? offer.lowPrice : undefined), offer.priceCurrency || pageCurrency);
    if (direct) return direct;
    for (const specification of list(offer.priceSpecification).map(resolve).filter(currentSpecification)) {
      const result = quote(specification.price, specification.priceCurrency || offer.priceCurrency || pageCurrency);
      if (result) return result;
    }
    return undefined;
  };
  const offers = list(product?.offers).map(resolve);
  const matchingOffers = offers.filter((offer) => exactPageMatches(offer.url, pageUrl));
  // A base product page commonly publishes one explicit default-variant offer
  // (e.g. Shopify stores). Accept that offer, or equal-priced variants, without
  // confusing it with a different variant explicitly requested by the user.
  const defaultOffers = offers.filter((offer) => !offer.url || !hasVariantSelector(new URL(pageUrl)) && pageMatches(offer.url, pageUrl));
  const selectedOffers = matchingOffers.length ? matchingOffers : defaultOffers;
  const candidates = selectedOffers.map(fromOffer).filter((entry): entry is ProductPriceQuote => !!entry);
  // Conflicting variant offers have no single current price unless the page
  // identifies the selected variant or supplies its own current-price metadata.
  if (candidates.length && candidates.length === selectedOffers.length && candidates.every((entry) => entry.currency === candidates[0].currency && Number(entry.price) === Number(candidates[0].price))) return candidates[0];
  const metadataQuote = quote(meta("product:price:amount", "og:price:amount", "price"), pageCurrency);
  if (metadataQuote) return metadataQuote;
  const shopify = object(object(shopifyData).product ?? shopifyData);
  const variants = list(shopify.variants).map(object);
  const selectedId = new URL(pageUrl).searchParams.get("variant");
  const variant = selectedId ? variants.find((entry) => scalar(entry.id) === selectedId) : variants[0];
  return quote(variant?.price, shopify.currency || pageCurrency);
}

/** Pure extraction is exported so retailer markup can be regression-tested without network requests. */
export function extractProduct(html: string, pageUrl: string, shopifyData?: unknown, sourceUrl = pageUrl): ProductImport {
  const $ = cheerio.load(html);
  const meta = (...names: string[]) => {
    for (const name of names) {
      const value = $(`meta[property='${name}'], meta[name='${name}'], meta[itemprop='${name}']`).first().attr("content");
      if (value?.trim()) return value.trim();
    }
    return "";
  };
  const nodes = jsonNodes($);
  const references = new Map<string, Data>();
  for (const node of nodes) {
    const id = scalar(node["@id"]);
    if (id && Object.keys(node).length > Object.keys(references.get(id) ?? {}).length) references.set(id, node);
  }
  const resolve = (value: unknown): Data => ({ ...references.get(scalar(object(value)["@id"])), ...object(value) });
  const products = nodes.filter((node) => hasType(node, "Product") || hasType(node, "ProductGroup"));
  products.sort((a, b) => Number(pageMatches(b.url ?? b["@id"], pageUrl)) - Number(pageMatches(a.url ?? a["@id"], pageUrl)));
  let product = products[0] ?? {};
  const group = hasType(product, "ProductGroup") ? product : resolve(product.isVariantOf);
  if (hasType(product, "ProductGroup")) {
    const variants = list(product.hasVariant).map(resolve);
    const selected = variants.find((variant) => scalar(variant.url) === pageUrl) ?? variants[0] ?? {};
    product = { ...product, ...selected };
  }
  const shopify = object(object(shopifyData).product ?? shopifyData);
  const offers = list(product.offers).map(resolve);
  const offer = offers.find((entry) => pageMatches(entry.url, pageUrl)) ?? offers[0] ?? {};
  const specification = resolve(list(offer.priceSpecification)[0]);
  const brandData = resolve(product.brand ?? group.brand ?? product.manufacturer);
  const variant = object(list(shopify.variants)[0]);

  const name = clean(product.name || group.name || shopify.title || meta("og:title", "twitter:title") || $("h1").first().text() || $("title").text(), 200);
  const description = clean(product.description || group.description || shopify.body_html || meta("og:description", "description", "twitter:description"), 5000);
  const brand = clean(brandData.name || product.brand || shopify.vendor || meta("product:brand", "brand"), 120);
  const price = clean(offer.price ?? offer.lowPrice ?? specification.price ?? variant.price ?? meta("product:price:amount", "og:price:amount", "price"), 40);
  const currency = clean(offer.priceCurrency || specification.priceCurrency || meta("product:price:currency", "og:price:currency", "priceCurrency"), 8).toUpperCase();

  const candidates: { url: string; score: number; index: number }[] = [];
  const addImage = (value: unknown, baseScore: number, label = "") => {
    if (Array.isArray(value)) { value.forEach((image) => addImage(image, baseScore, label)); return; }
    if (value && typeof value === "object") {
      const image = resolve(value);
      addImage(image.contentUrl || image.url || image.src, baseScore, scalar(image.caption || image.name || image.alt || label));
      return;
    }
    const url = absoluteImage(value, pageUrl);
    if (!url || /\b(?:logo|icon|placeholder|payment|swatch|size[-_ ]?chart)\b/i.test(`${label} ${new URL(url).pathname}`)) return;
    const text = `${label} ${new URL(url).pathname}`.toLowerCase();
    const score = baseScore + (/packshot|flat[-_ ]?lay|product[-_ ]?only|isolated|white[-_ ]?background/.test(text) ? 80 : 0) - (/on[-_ ]?model|lifestyle|model[-_ ]?(?:shot|image|front|back)/.test(text) ? 40 : 0);
    if (!candidates.some((candidate) => candidate.url === url)) candidates.push({ url, score, index: candidates.length });
  };
  // Use a single authoritative gallery. Mixing page-wide product blocks adds
  // unrelated recommendation, navigation, and recently viewed item photos.
  addImage(shopify.images, 110);
  addImage(shopify.image, 110);
  if (!candidates.length) {
    addImage(product.image, 110);
    addImage(group.image, 105);
  }
  if (!candidates.length) $("meta[property='og:image'], meta[property='og:image:secure_url'], meta[name='twitter:image'], meta[itemprop='image']").each((_, element) => addImage($(element).attr("content"), 90));
  if (!candidates.length) $("[itemprop='image'][src], product-gallery img, [data-product-media] img, [data-product-images] img, [class*='product-gallery'] img, [class*='product__media'] img, [class*='product__image'] img, [class*='product-media'] img, [class*='product-images'] img, [id*='ProductMedia'] img").slice(0, 120).each((_, element) => {
    const image = $(element);
    const ancestors = image.parents().toArray().map((parent) => `${$(parent).attr("class") ?? ""} ${$(parent).attr("id") ?? ""} ${parent.tagName}`).join(" ");
    if (/recommend|related|recently[-_ ]?viewed|similar|product[-_ ]?card|search[-_ ]?result|cart[-_ ]?drawer|upsell|cross[-_ ]?sell/i.test(ancestors)) return;
    const width = Number(image.attr("width") ?? 0);
    const height = Number(image.attr("height") ?? 0);
    if (width > 0 && width < 150 || height > 0 && height < 150) return;
    const sourceSet = image.attr("srcset") || image.attr("data-srcset") || "";
    const largestSource = sourceSet.split(",").map((source) => source.trim().split(/\s+/)).filter((source) => source[0]).sort((a, b) => parseFloat(b[1] ?? "0") - parseFloat(a[1] ?? "0"))[0]?.[0];
    addImage(largestSource || image.attr("data-zoom-image") || image.attr("data-src") || image.attr("src"), 75, image.attr("alt"));
  });
  const images = candidates.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 24).map(({ url }) => url);

  if (!images.length) {
    const visibleText = $("title, h1, h2").text();
    if (/access denied|just a moment|verify you are human|security check|attention required|robot or human|captcha|unusual traffic/i.test(visibleText)) {
      throw new ProductImportError("This store blocks automatic imports. Try the product link from another store.", "BLOCKED_SITE");
    }
    throw new ProductImportError("No product photo was found on this page. Try the product’s direct link or another store.", "NO_IMAGE");
  }
  if (!name) throw new ProductImportError("The product details could not be read from this page. Try another product link.", "INVALID_PAGE");
  const priceQuote = extractProductPrice(html, pageUrl, shopifyData, sourceUrl);
  return {
    item: {
      name, brand, price, currency, description,
      purchaseUrl: validatePublicUrl(pageUrl).href,
      imageUrl: images[0],
      category: inferCategory(`${scalar(product.category)} ${scalar(shopify.product_type)} ${name}`),
      size: "",
      color: "",
    },
    images,
    ...(priceQuote ? { priceQuote } : {}),
  };
}

async function fetchProductPage(input: string, fetcher: typeof safeFetch) {
  const url = validatePublicUrl(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  const page = await fetcher(url, { maxBytes: 5 * 1024 * 1024, timeoutMs: 16000 });
  if ([401, 403, 429, 503].includes(page.status)) throw new ProductImportError("This store blocks automatic imports. Try the product link from another store.", "BLOCKED_SITE");
  if (page.status === 404 || page.status === 410) throw new ProductImportError("This product page is no longer available. Check the link or try another store.", "NOT_FOUND", 404);
  if (page.status < 200 || page.status >= 300) throw new ProductImportError("This store could not return the product page. Try again later.", "INVALID_PAGE", 502);
  if (page.contentType && !["text/html", "application/xhtml+xml"].includes(page.contentType)) throw new ProductImportError("This link does not point to a product page. Paste the store’s product URL.", "INVALID_PAGE");
  return { page, sourceUrl: url.href };
}

export async function importProduct(input: string, fetcher: typeof safeFetch = safeFetch): Promise<ProductImport> {
  const { page, sourceUrl } = await fetchProductPage(input, fetcher);
  const html = page.body.toString("utf8");
  let extracted: ProductImport | undefined;
  let extractionError: unknown;
  try { extracted = extractProduct(html, page.url, undefined, sourceUrl); } catch (error) { extractionError = error; }
  const productPath = new URL(page.url).pathname.match(/\/products\/([^/]+)\/?$/);
  // Fetch the complete product gallery even when HTML already contains metadata.
  if (productPath) {
    try {
      const jsonUrl = new URL(`/products/${productPath[1]}.json`, page.url);
      const response = await fetcher(jsonUrl, { maxBytes: 1024 * 1024, timeoutMs: 6500, accept: "application/json" });
      if (response.status === 200 && response.contentType === "application/json") extracted = extractProduct(html, page.url, JSON.parse(response.body.toString("utf8")), sourceUrl);
    } catch { /* Preserve usable page data or the original actionable import error. */ }
  }
  if (extracted) return extracted;
  throw extractionError ?? new ProductImportError("This product could not be imported. Try another store’s link.", "INVALID_PAGE");
}

export async function fetchProductPrice(input: string, fetcher: typeof safeFetch = safeFetch): Promise<ProductPriceQuote> {
  const { page, sourceUrl } = await fetchProductPage(input, fetcher);
  const html = page.body.toString("utf8");
  const quote = extractProductPrice(html, page.url, undefined, sourceUrl);
  if (quote) return quote;
  if (/access denied|just a moment|verify you are human|security check|attention required|robot or human|captcha|unusual traffic/i.test(cheerio.load(html)("title, h1, h2").text())) {
    throw new ProductImportError("This store blocks automatic price checks. Try another listing link.", "BLOCKED_SITE");
  }
  const productPath = new URL(page.url).pathname.match(/\/products\/([^/]+)\/?$/);
  if (productPath) {
    try {
      const jsonUrl = new URL(`/products/${productPath[1]}.json`, page.url);
      const response = await fetcher(jsonUrl, { maxBytes: 1024 * 1024, timeoutMs: 6500, accept: "application/json" });
      if (response.status === 200 && response.contentType === "application/json") {
        const fallback = extractProductPrice(html, page.url, JSON.parse(response.body.toString("utf8")), sourceUrl);
        if (fallback) return fallback;
      }
    } catch { /* A store may not provide public Shopify JSON. */ }
  }
  throw new ProductImportError("No current price and currency were found on this page. Try another listing link.", "NO_PRICE");
}
