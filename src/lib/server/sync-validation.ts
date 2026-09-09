import type { Item, Outfit, PriceHistoryEntry, SyncChange, WishlistItem, WishlistSource } from "../types";
import { CATEGORIES } from "../types";
import { MAX_IMAGE_CHARS, MAX_ITEM_IMAGE_CHARS } from "../image-limits";
import { assertWishlistLimits, isWishlistCurrency, MAX_PRICE_HISTORY, MAX_WISHLIST_SOURCES, normalizeListingUrl, recomputeWishlistPrice, wishlistPriceNumber } from "../wishlist";

export { MAX_IMAGE_CHARS } from "../image-limits";

export const MAX_SYNC_BYTES = 3_800_000;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max) throw new Error("A field is invalid or too long.");
  return value;
}
function stamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) throw new Error("An item has an invalid timestamp.");
  return value;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) throw new Error("An item has an invalid ID.");
  return value;
}
function image(value: unknown): string {
  const result = text(value, MAX_IMAGE_CHARS);
  if (result && !/^data:image\/(?:jpeg|png|webp|avif);base64,[a-z0-9+/]+=*$/i.test(result)) throw new Error("An image has an unsupported format.");
  return result;
}
function url(value: unknown): string {
  const result = text(value, 8_000);
  if (!result) return result;
  try {
    const parsed = new URL(result);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new Error();
  } catch { throw new Error("An item contains an invalid link."); }
  return result;
}
function listingUrl(value: unknown): string {
  return normalizeListingUrl(url(value));
}
function currency(value: unknown): string {
  if (!isWishlistCurrency(value)) throw new Error("A wishlist item has an invalid currency code.");
  return value;
}
function price(value: unknown): string {
  const result = text(value, 100);
  if (result && wishlistPriceNumber(result) === null) throw new Error("A wishlist item has an invalid price.");
  return result;
}
function flag(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("A wishlist item has an invalid link status.");
  return value;
}
function wishlistFields(source: Record<string, unknown>, base: Item): WishlistItem {
  if (source.rating !== null && (typeof source.rating !== "number" || !Number.isFinite(source.rating) || source.rating < 0.5 || source.rating > 5 || !Number.isInteger(source.rating * 2))) {
    throw new Error("A wishlist rating must be a half-star increment from 0.5 to 5, or empty.");
  }
  if (!Array.isArray(source.sources) || source.sources.length > MAX_WISHLIST_SOURCES || (source.purchaseUrl && !source.sources.length)) throw new Error("A wishlist item has too many or missing listing sources.");
  const urls = new Set<string>();
  const sources = source.sources.map((entry): WishlistSource => {
    if (!isObject(entry)) throw new Error("A wishlist listing source is invalid.");
    const normalized = listingUrl(entry.url);
    if (urls.has(normalized)) throw new Error("A wishlist listing source occurs twice.");
    urls.add(normalized);
    return { url: normalized, price: price(entry.price), currency: currency(entry.currency), fetched_at: entry.fetched_at === null ? null : stamp(entry.fetched_at), link_broken: flag(entry.link_broken) };
  });
  if (!Array.isArray(source.priceHistory) || source.priceHistory.length > MAX_PRICE_HISTORY) throw new Error("A wishlist item's price history is too long or invalid.");
  const priceHistory = source.priceHistory.map((entry): PriceHistoryEntry => {
    if (!isObject(entry) || typeof entry.price !== "number" || !Number.isFinite(entry.price) || entry.price < 0) throw new Error("A price history entry has an invalid price.");
    const source_url = listingUrl(entry.source_url);
    if (!urls.has(source_url)) throw new Error("A price history entry has an unknown listing source.");
    return { price: entry.price, currency: currency(entry.currency), source_url, fetched_at: stamp(entry.fetched_at) };
  });
  const record: WishlistItem = {
    ...base, price: price(source.price), currency: currency(source.currency), purchaseUrl: source.purchaseUrl === "" ? "" : listingUrl(source.purchaseUrl),
    rating: source.rating as number | null, sources, priceHistory,
    link_broken: flag(source.link_broken), currentSourceUrl: source.currentSourceUrl === "" ? "" : listingUrl(source.currentSourceUrl),
  };
  if (record.purchaseUrl && !urls.has(record.purchaseUrl)) throw new Error("The wishlist item's purchase link is missing from its listing sources.");
  const derived = recomputeWishlistPrice(record);
  if (derived.currentSourceUrl !== record.currentSourceUrl || derived.link_broken !== record.link_broken || derived.price !== record.price) throw new Error("A wishlist item's current price or link status is inconsistent with its sources.");
  assertWishlistLimits(record);
  return record;
}
export function validateSyncRequest(value: unknown): { expectedUserId: string; cursor: number; changes: SyncChange[] } {
  if (!isObject(value)) throw new Error("Invalid sync request.");
  const expectedUserId = text(value.expectedUserId, 256);
  if (!expectedUserId) throw new Error("A sync account is required.");
  const cursor = stamp(value.cursor);
  if (!Array.isArray(value.changes) || value.changes.length > 30) throw new Error("Too many changes in one sync request.");
  const seen = new Set<string>();
  const changes = value.changes.map((change): SyncChange => {
    if (!isObject(change) || !isObject(change.record)) throw new Error("Invalid sync change.");
    if (change.collection !== "items" && change.collection !== "outfits" && change.collection !== "wishlist") throw new Error("Invalid collection.");
    const source = change.record;
    const id = uuid(source.id);
    const key = `${change.collection}:${id}`;
    if (seen.has(key)) throw new Error("An item occurs twice in a sync request.");
    seen.add(key);
    const base = {
      id, name: text(source.name, 500), createdAt: stamp(source.createdAt), updatedAt: stamp(source.updatedAt),
      deletedAt: source.deletedAt == null ? null : stamp(source.deletedAt),
    };
    let record: Item | Outfit | WishlistItem;
    if (change.collection === "items" || change.collection === "wishlist") {
      if (!CATEGORIES.includes(source.category as Item["category"])) throw new Error("Invalid item category.");
      const imageData = source.imageData === undefined ? undefined : image(source.imageData);
      const backImageData = source.backImageData === undefined ? undefined : image(source.backImageData);
      const sideImageData = source.sideImageData === undefined ? undefined : image(source.sideImageData);
      if ((imageData?.length ?? 0) + (backImageData?.length ?? 0) + (sideImageData?.length ?? 0) > MAX_ITEM_IMAGE_CHARS) {
        throw new Error("An item's images are too large.");
      }
      record = {
        ...base, category: source.category as Item["category"], brand: text(source.brand, 300),
        size: text(source.size, 100), color: text(source.color, 200), price: text(source.price, 100),
        currency: text(source.currency, 20), description: text(source.description, 20_000),
        purchaseUrl: url(source.purchaseUrl), imageUrl: url(source.imageUrl),
        ...(imageData !== undefined ? { imageData } : {}),
        ...(source.backImageUrl !== undefined ? { backImageUrl: url(source.backImageUrl) } : {}),
        ...(backImageData !== undefined ? { backImageData } : {}),
        ...(source.sideImageUrl !== undefined ? { sideImageUrl: url(source.sideImageUrl) } : {}),
        ...(sideImageData !== undefined ? { sideImageData } : {}),
      };
      if (change.collection === "wishlist") record = wishlistFields(source, record);
    } else {
      if (!Array.isArray(source.itemIds) || source.itemIds.length > 30) throw new Error("An outfit contains too many pieces.");
      record = { ...base, itemIds: source.itemIds.map(uuid), imageData: image(source.imageData) };
    }
    return { collection: change.collection, record, baseRevision: stamp(change.baseRevision), token: uuid(change.token) };
  });
  return { expectedUserId, cursor, changes };
}

export async function readSyncBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_SYNC_BYTES) throw new Error("Sync request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("A sync request body is required.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_SYNC_BYTES) { await reader.cancel(); throw new Error("Sync request is too large."); }
    chunks.push(value);
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(joined));
}
