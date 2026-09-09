import type { Collection, Item, Outfit, SyncChange, SyncResponse, SyncRow, WardrobeRecord } from "./types";

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
export interface Snapshot { items: Item[]; outfits: Outfit[]; referencePhoto: string | null; }
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
    referencePhoto: referencePhoto ?? null,
  };
}
export async function writeRecord(space: string, collection: Collection, record: WardrobeRecord): Promise<void> {
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
export async function removeRecord(space: string, collection: Collection, id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction("records", "readwrite");
  const done = completed(tx);
  const store = tx.objectStore("records");
  const key = keyFor(space, collection, id);
  const previous = await request(store.get(key)) as StoredRecord | undefined;
  if (previous) {
    const now = Math.max(Date.now(), previous.record.updatedAt + 1);
    store.put({ ...previous, record: { ...previous.record, imageData: "", updatedAt: now, deletedAt: now }, pendingToken: crypto.randomUUID() });
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
