import type { Item, Outfit, SyncChange } from "../types";
import { CATEGORIES } from "../types";
import { MAX_IMAGE_CHARS, MAX_ITEM_IMAGE_CHARS } from "../image-limits";

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
export function validateSyncRequest(value: unknown): { expectedUserId: string; cursor: number; changes: SyncChange[] } {
  if (!isObject(value)) throw new Error("Invalid sync request.");
  const expectedUserId = text(value.expectedUserId, 256);
  if (!expectedUserId) throw new Error("A sync account is required.");
  const cursor = stamp(value.cursor);
  if (!Array.isArray(value.changes) || value.changes.length > 30) throw new Error("Too many changes in one sync request.");
  const seen = new Set<string>();
  const changes = value.changes.map((change): SyncChange => {
    if (!isObject(change) || !isObject(change.record)) throw new Error("Invalid sync change.");
    if (change.collection !== "items" && change.collection !== "outfits") throw new Error("Invalid collection.");
    const source = change.record;
    const id = uuid(source.id);
    const key = `${change.collection}:${id}`;
    if (seen.has(key)) throw new Error("An item occurs twice in a sync request.");
    seen.add(key);
    const base = {
      id, name: text(source.name, 500), createdAt: stamp(source.createdAt), updatedAt: stamp(source.updatedAt),
      deletedAt: source.deletedAt == null ? null : stamp(source.deletedAt),
    };
    let record: Item | Outfit;
    if (change.collection === "items") {
      if (!CATEGORIES.includes(source.category as Item["category"])) throw new Error("Invalid item category.");
      const imageData = source.imageData === undefined ? undefined : image(source.imageData);
      const backImageData = source.backImageData === undefined ? undefined : image(source.backImageData);
      if ((imageData?.length ?? 0) + (backImageData?.length ?? 0) > MAX_ITEM_IMAGE_CHARS) {
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
      };
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
