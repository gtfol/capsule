import type { Collection, Item, Outfit, SyncChange, SyncResponse, SyncRow, WardrobeRecord, WishlistItem } from "./types";
import { assertWishlistLimits } from "./wishlist";
import { findDuplicatePiece, pieceSourceKey, type SharedImportResult } from "./piece-identity";

// Each account has a separate space. Pending tokens live in the same atomic
// record as the edit, so an interrupted write cannot lose its sync queue.
const DATABASE = "capsule-v1";
export const GUEST_SPACE = "guest";
export const accountSpace = (userId: string) => `account:${userId}`;
export interface StoredRecord {
  key: string;
  space: string;
  collection: Collection;
  id: string;
  record: WardrobeRecord;
  revision: number;
  pendingToken: string | null;
}
interface Meta { key: string; value: unknown; }
export interface Snapshot { items: Item[]; outfits: Outfit[]; wishlist: WishlistItem[]; referencePhoto: string | null; }
let databasePromise: Promise<IDBDatabase> | null = null;
let channel: BroadcastChannel | null = null;
type ChangeSource = "local" | "remote";
const listeners = new Set<(space: string, source: ChangeSource) => void>();
const keyFor = (space: string, collection: Collection, id: string) => `${space}|${collection}|${id}`;
const metaKey = (space: string, name: string) => `${space}|${name}`;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Browser storage failed."));
  });
}
function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Browser storage failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Browser storage was interrupted."));
  });
}
export function subscribeToLocalChanges(listener: (space: string, source: ChangeSource) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function notify(space: string, source: ChangeSource = "local") {
  listeners.forEach((listener) => listener(space, source));
  channel?.postMessage({ space, source });
}
export function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("This browser does not provide local storage."));
    const req = indexedDB.open(DATABASE, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const records = db.createObjectStore("records", { keyPath: "key" });
      records.createIndex("space", "space");
      db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); databasePromise = null; };
      if (typeof BroadcastChannel !== "undefined" && !channel) {
        channel = new BroadcastChannel("capsule-local-changes");
        channel.onmessage = ({ data }) => {
          if (typeof data?.space === "string" && (data.source === "local" || data.source === "remote")) {
            listeners.forEach((listener) => listener(data.space, data.source));
          }
        };
      }
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("Unable to open browser storage."));
    req.onblocked = () => reject(new Error("Close other Capsule tabs, then reload to update storage."));
  });
  databasePromise.catch(() => { databasePromise = null; });
  return databasePromise;
}
async function metaValue<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  const value = await request(db.transaction("meta", "readonly").objectStore("meta").get(key)) as Meta | undefined;
  return value?.value as T | undefined;
}
// Remove keys saved by the unreleased browser-storage preview. Never read,
// reuse, upload, or migrate these plaintext credentials into an account.
export async function clearLegacyRenderKeys(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction("meta", "readwrite");
  const done = completed(tx);
  const store = tx.objectStore("meta");
  try {
    const keys = await request(store.getAllKeys());
    for (const key of keys) if (typeof key === "string" && key.endsWith("|render-api-key")) store.delete(key);
    await done;
  } catch (error) {
    try { tx.abort(); } catch { /* The transaction may already be complete. */ }
    await done.catch(() => undefined);
    throw error;
  }
}
export async function currentSpace(): Promise<string> {
  return (await metaValue<string>("active-space")) ?? GUEST_SPACE;
}
export async function activateSpace(space: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction("meta", "readwrite");
  const done = completed(tx);
  tx.objectStore("meta").put({ key: "active-space", value: space });
  await done;
}
export async function importGuestOnce(userId: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(["records", "meta"], "readwrite");
  const done = completed(tx);
  const meta = tx.objectStore("meta");
  const records = tx.objectStore("records");
  const owner = await request(meta.get("guest-import-owner")) as Meta | undefined;
  if (!owner) {
    const space = accountSpace(userId);
    const guest = await request(records.index("space").getAll(GUEST_SPACE)) as StoredRecord[];
    for (const row of guest) {
      const key = keyFor(space, row.collection, row.id);
      const existing = await request(records.get(key));
      if (!existing) records.put({ ...row, key, space, revision: 0, pendingToken: crypto.randomUUID() });
    }
    const photo = await request(meta.get(metaKey(GUEST_SPACE, "reference-photo"))) as Meta | undefined;
    if (photo) meta.put({ key: metaKey(space, "reference-photo"), value: photo.value });
    meta.put({ key: "guest-import-owner", value: userId });
  }
  await done;
}
export async function listStored(space: string): Promise<StoredRecord[]> {
  const db = await openDatabase();
  return request(db.transaction("records", "readonly").objectStore("records").index("space").getAll(space));
}
export async function readSnapshot(space: string): Promise<Snapshot> {
  const [records, referencePhoto] = await Promise.all([
    listStored(space), metaValue<string>(metaKey(space, "reference-photo")),
  ]);
  const alive = records.filter((row) => !row.record.deletedAt);
  const byDate = (a: WardrobeRecord, b: WardrobeRecord) => b.createdAt - a.createdAt;
  return {
    items: alive.filter((r) => r.collection === "items").map((r) => r.record as Item).sort(byDate),
    outfits: alive.filter((r) => r.collection === "outfits").map((r) => r.record as Outfit).sort(byDate),
    wishlist: alive.filter((r) => r.collection === "wishlist").map((r) => r.record as WishlistItem).sort(byDate),
    referencePhoto: referencePhoto ?? null,
  };
}
export async function writeRecord(space: string, collection: Collection, record: WardrobeRecord): Promise<void> {
  if (collection === "wishlist") assertWishlistLimits(record as WishlistItem);
  const db = await openDatabase();
  const tx = db.transaction("records", "readwrite");
  const done = completed(tx);
  const store = tx.objectStore("records");
  const key = keyFor(space, collection, record.id);
  const previous = await request(store.get(key)) as StoredRecord | undefined;
  const updatedAt = Math.max(Date.now(), (previous?.record.updatedAt ?? 0) + 1, record.updatedAt);
  store.put({ key, space, collection, id: record.id, record: { ...record, updatedAt }, revision: previous?.revision ?? 0, pendingToken: crypto.randomUUID() } satisfies StoredRecord);
  await done;
  notify(space);
}
// Import a shared selection and its receipt together. Concurrent tabs and
// retries cannot duplicate a selection, overwrite a piece, or save half a set.
export async function importSharedRecords(space: string, collection: "items" | "wishlist", records: Array<Item | WishlistItem>, receipt: string, guard: () => void): Promise<SharedImportResult> {
  guard();
  if (!space.startsWith("account:") || !space.slice(8)) throw new Error("Sign in before adding shared pieces.");
  if (!receipt || receipt.length > 256 || records.length < 1 || records.length > 300) throw new Error("This shared selection is invalid.");
  const ids = new Set<string>();
  for (const record of records) {
    if (!record.id || ids.has(record.id) || record.deletedAt) throw new Error("This shared selection contains an invalid piece.");
    ids.add(record.id);
    if (collection === "wishlist") assertWishlistLimits(record as WishlistItem);
  }
  const db = await openDatabase();
  guard();
  const tx = db.transaction(["records", "meta"], "readwrite");
  const done = completed(tx);
  const meta = tx.objectStore("meta");
  const store = tx.objectStore("records");
  const receiptKey = metaKey(space, `share-copy|${receipt}`);
  try {
    const active = await request(meta.get("active-space")) as Meta | undefined;
    guard();
    if (active?.value !== space) throw new Error("Your active wardrobe changed. Try again.");
    const previous = await request(meta.get(receiptKey)) as Meta | undefined;
    guard();
    let importedIds: string[] = [];
    if (previous) {
      const value = previous.value as { collection?: unknown; ids?: unknown } | null;
      if (!value || value.collection !== collection || !Array.isArray(value.ids) || value.ids.length !== records.length || !value.ids.every((id) => typeof id === "string" && id.length > 0)) {
        throw new Error("This selection’s previous copies could not be checked. Try sharing a new link.");
      }
      importedIds = value.ids as string[];
    }
    const nextIds: string[] = [];
    // Recheck inside the write transaction, including imports from other tabs
    // and earlier pieces in this selection. Never overwrite an existing item.
    const rows = await request(store.index("space").getAll(space)) as StoredRecord[];
    guard();
    const candidates = rows.filter((row) => row.collection === collection && !row.record.deletedAt).map((row) => row.record as Item);
    let added = 0;
    for (const [index, record] of records.entries()) {
      // A receipt is a map to the copies, not a permanent claim that they
      // still exist. Preserve edited survivors and restore only missing
      // pieces under fresh IDs after deletion or a wishlist-to-wardrobe move.
      if (importedIds[index]) {
        const imported = await request(store.get(keyFor(space, collection, importedIds[index]))) as StoredRecord | undefined;
        guard();
        if (imported && !imported.record.deletedAt) { nextIds.push(imported.id); continue; }
      }
      const key = keyFor(space, collection, record.id);
      const existing = await request(store.get(key));
      guard();
      if (existing) throw new Error("A shared piece could not be added. Try again.");
      const duplicate = findDuplicatePiece(record, candidates);
      if (duplicate) { nextIds.push(duplicate.id); continue; }
      await request(store.add({ key, space, collection, id: record.id, record, revision: 0, pendingToken: crypto.randomUUID() } satisfies StoredRecord));
      guard();
      nextIds.push(record.id);
      candidates.push(record);
      added++;
    }
    await request(meta.put({ key: receiptKey, value: { collection, ids: nextIds } }));
    guard();
    await done;
    if (added) notify(space);
    return { count: added, skipped: records.length - added, alreadyAdded: added === 0, itemIds: nextIds };
  } catch (error) {
    try { tx.abort(); } catch { /* The transaction may already be complete. */ }
    await done.catch(() => undefined);
    throw error;
  }
}
// Price requests can finish after edits in another tab. Apply their result to
// the latest stored item atomically, and never recreate a deleted item.
export async function updateWishlistRecord(space: string, id: string, transform: (current: WishlistItem) => WishlistItem): Promise<WishlistItem | null> {
  const db = await openDatabase();
  const tx = db.transaction("records", "readwrite");
  const done = completed(tx);
  const store = tx.objectStore("records");
  try {
    const previous = await request(store.get(keyFor(space, "wishlist", id))) as StoredRecord | undefined;
    if (!previous || previous.record.deletedAt) { await done; return null; }
    const changed = transform(previous.record as WishlistItem);
    if (changed.id !== id || changed.deletedAt) throw new Error("The wishlist item changed while it was being saved.");
    const record = { ...changed, updatedAt: Math.max(Date.now(), previous.record.updatedAt + 1, changed.updatedAt) };
    assertWishlistLimits(record);
    store.put({ ...previous, record, pendingToken: crypto.randomUUID() });
    await done;
    notify(space);
    return record;
  } catch (error) {
    // A synchronous transform failure must abort rather than leave a rejected
    // transaction promise unhandled.
    try { tx.abort(); } catch { /* The transaction may already be complete. */ }
    await done.catch(() => undefined);
    throw error;
  }
}
export async function moveWishlistToWardrobe(space: string, id: string, transform?: (current: WishlistItem) => WishlistItem): Promise<Item | null> {
  const db = await openDatabase();
  const tx = db.transaction("records", "readwrite");
  const done = completed(tx);
  const store = tx.objectStore("records");
  try {
    const previous = await request(store.get(keyFor(space, "wishlist", id))) as StoredRecord | undefined;
    if (!previous || previous.record.deletedAt) { await done; return null; }
    const current = transform ? transform(previous.record as WishlistItem) : previous.record as WishlistItem;
    if (current.id !== id || current.deletedAt) throw new Error("The wishlist item changed while it was being moved.");
    assertWishlistLimits(current);
    let ownedId = id;
    while (await request(store.get(keyFor(space, "items", ownedId)))) ownedId = crypto.randomUUID();
    const now = Date.now();
    const updatedAt = Math.max(now, previous.record.updatedAt + 1, current.updatedAt);
    const { rating: _rating, priceHistory: _history, sources: _sources, link_broken: _broken, currentSourceUrl: _source, ...fields } = current;
    void _rating; void _history; void _sources; void _broken; void _source;
    const owned: Item = { ...fields, sourceKey: pieceSourceKey(current), id: ownedId, createdAt: now, updatedAt, deletedAt: null };
    store.put({ ...previous, record: { ...current, imageData: "", backImageData: "", sideImageData: "", updatedAt, deletedAt: updatedAt }, pendingToken: crypto.randomUUID() } satisfies StoredRecord);
    store.put({ key: keyFor(space, "items", ownedId), space, collection: "items", id: ownedId, record: owned, revision: 0, pendingToken: crypto.randomUUID() } satisfies StoredRecord);
    await done;
    notify(space);
    return owned;
  } catch (error) {
    try { tx.abort(); } catch { /* The transaction may already be complete. */ }
    await done.catch(() => undefined);
    throw error;
  }
}
// Capture Undo's exact record in the same transaction that writes its
// tombstone, so a stale tab cannot discard newer quotes or edited photos.
export async function deleteWishlistRecord(space: string, id: string, beforeDelete?: () => void): Promise<WishlistItem | null> {
  const db = await openDatabase();
  const tx = db.transaction("records", "readwrite");
  const done = completed(tx);
  const store = tx.objectStore("records");
  try {
    const previous = await request(store.get(keyFor(space, "wishlist", id))) as StoredRecord | undefined;
    if (!previous || previous.record.deletedAt) { await done; return null; }
    beforeDelete?.();
    const removed = previous.record as WishlistItem;
    const now = Math.max(Date.now(), removed.updatedAt + 1);
    store.put({ ...previous, record: { ...removed, imageData: "", backImageData: "", sideImageData: "", updatedAt: now, deletedAt: now }, pendingToken: crypto.randomUUID() } satisfies StoredRecord);
    await done;
    notify(space);
    return removed;
  } catch (error) {
    try { tx.abort(); } catch { /* The transaction may already be complete. */ }
    await done.catch(() => undefined);
    throw error;
  }
}
export async function removeRecord(space: string, collection: Collection, id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction("records", "readwrite");
  const done = completed(tx);
  const store = tx.objectStore("records");
  const key = keyFor(space, collection, id);
  const previous = await request(store.get(key)) as StoredRecord | undefined;
  if (previous) {
    const now = Math.max(Date.now(), previous.record.updatedAt + 1);
    store.put({ ...previous, record: { ...previous.record, imageData: "", ...(collection !== "outfits" ? { backImageData: "", sideImageData: "" } : {}), updatedAt: now, deletedAt: now }, pendingToken: crypto.randomUUID() });
  }
  await done;
  notify(space);
}
export async function writeReferencePhoto(space: string, image: string | null): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction("meta", "readwrite");
  const done = completed(tx);
  tx.objectStore("meta").put({ key: metaKey(space, "reference-photo"), value: image });
  await done;
  notify(space);
}
export async function pendingChanges(space: string): Promise<SyncChange[]> {
  return (await listStored(space)).filter((row) => row.pendingToken).map((row) => ({
    collection: row.collection, record: row.record, baseRevision: row.revision, token: row.pendingToken!,
  }));
}
export async function syncCursor(space: string): Promise<number> {
  return (await metaValue<number>(metaKey(space, "sync-cursor"))) ?? 0;
}
function remoteRecord(space: string, row: SyncRow): StoredRecord {
  return { key: keyFor(space, row.collection, row.record.id), space, collection: row.collection, id: row.record.id, record: row.record, revision: row.revision, pendingToken: null };
}
// Acknowledgements, pulled records, and cursor advance are one transaction.
// A new local edit keeps its pending token even if an older request succeeds.
export async function applySyncResponse(space: string, sent: SyncChange[], response: SyncResponse): Promise<number> {
  if (space !== accountSpace(response.userId)) throw new Error("The signed-in account changed. Try syncing again.");
  const db = await openDatabase();
  const tx = db.transaction(["records", "meta"], "readwrite");
  const done = completed(tx);
  const records = tx.objectStore("records");
  let conflicts = 0;
  const sentByKey = new Map(sent.map((change) => [keyFor(space, change.collection, change.record.id), change]));
  for (const outcome of response.results) {
    const key = keyFor(space, outcome.collection, outcome.id);
    const original = sentByKey.get(key);
    const local = await request(records.get(key)) as StoredRecord | undefined;
    if (!original || !local) continue;
    if (outcome.status === "ok") {
      // Another tab may already have applied a newer revision.
      if (outcome.revision >= local.revision) records.put({ ...local, revision: outcome.revision, pendingToken: local.pendingToken === original.token ? null : local.pendingToken });
    } else if (local.pendingToken === original.token) {
      if (!local.record.deletedAt) {
        const id = crypto.randomUUID();
        const now = Date.now();
        records.put({ ...local, key: keyFor(space, local.collection, id), id, record: { ...local.record, id, name: `${local.record.name.slice(0, 493)} (copy)`, createdAt: now, updatedAt: now }, revision: 0, pendingToken: crypto.randomUUID() });
      }
      records.put(remoteRecord(space, outcome.server));
      conflicts++;
    }
  }
  for (const row of response.rows) {
    const key = keyFor(space, row.collection, row.record.id);
    const local = await request(records.get(key)) as StoredRecord | undefined;
    if (!local || (!local.pendingToken && row.revision > local.revision)) records.put(remoteRecord(space, row));
  }
  const meta = tx.objectStore("meta");
  const cursorKey = metaKey(space, "sync-cursor");
  const previousCursor = await request(meta.get(cursorKey)) as Meta | undefined;
  meta.put({ key: cursorKey, value: Math.max(Number(previousCursor?.value) || 0, response.cursor) });
  await done;
  notify(space, "remote");
  return conflicts;
}
