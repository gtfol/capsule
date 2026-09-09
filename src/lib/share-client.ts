"use client";
import { openDatabase } from "./db";
import { compressImage, imageSource } from "./images";
import { useWardrobe } from "./store";
import type { Item, Outfit, WishlistItem } from "./types";
import type { ShareExpiry, ShareSnapshot, SharedPiece } from "./share-types";

export type ShareTarget =
  | { kind: "wardrobe"; pieces: Item[] }
  | { kind: "wishlist"; pieces: Item[] }
  | { kind: "piece"; piece: Item | WishlistItem }
  | { kind: "outfit"; outfit: Outfit; pieces: Item[] };
export interface ShareRecord {
  id: string;
  token: string;
  expiresAt: number | null;
  updatedAt: number;
  sourceVersion: string;
  expiry: ShareExpiry;
  pending: boolean;
  title?: string;
  kind?: ShareSnapshot["kind"];
}
const BODY_BUDGET = 3_800_000;
const recordKey = (space: string, key: string) => `${space}|share-link|${key}`;
export const shareTargetKey = (target: ShareTarget) => target.kind === "piece" ? `piece:${target.piece.id}` : target.kind === "outfit" ? `outfit:${target.outfit.id}` : target.kind;
const piecesOf = (target: ShareTarget) => target.kind === "piece" ? [target.piece] : target.pieces;
export function shareTargetVersion(target: ShareTarget): string {
  return JSON.stringify([target.kind, ...(target.kind === "outfit" ? [target.outfit.id, target.outfit.updatedAt] : []), ...piecesOf(target).map((piece) => `${piece.id}:${piece.updatedAt}`).sort()]);
}
export const shareUrl = (id: string) => `${window.location.origin}/share/${id}`;
function assertSpace(space: string) {
  if (useWardrobe.getState().space !== space) throw new Error("Your active wardrobe changed. Reopen Share to continue.");
}
function randomToken(bytes: number): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes)))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function validRecord(value: unknown): value is ShareRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as ShareRecord;
  return /^[A-Za-z0-9_-]{22}$/.test(r.id) && /^[A-Za-z0-9_-]{43}$/.test(r.token) && (r.expiresAt === null || Number.isFinite(r.expiresAt)) && Number.isFinite(r.updatedAt) && typeof r.sourceVersion === "string" && ["7d", "30d", "never"].includes(r.expiry) && typeof r.pending === "boolean";
}
async function editRecord(space: string, key: string, edit: (current: ShareRecord | null) => ShareRecord | null): Promise<ShareRecord | null> {
  const db = await openDatabase();
  assertSpace(space);
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite");
    const store = tx.objectStore("meta");
    const name = recordKey(space, key);
    let result: ShareRecord | null = null;
    let cause: unknown;
    const req = store.get(name);
    req.onsuccess = () => {
      try {
        assertSpace(space);
        result = edit(validRecord(req.result?.value) ? req.result.value : null);
        if (result) store.put({ key: name, value: result });
        else store.delete(name);
      } catch (error) { cause = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(cause ?? new Error("Your share link could not be saved in this browser. Free some storage and try again."));
  });
}
export async function readShareRecord(space: string, key: string): Promise<ShareRecord | null> {
  const db = await openDatabase();
  assertSpace(space);
  return new Promise((resolve, reject) => {
    const req = db.transaction("meta", "readonly").objectStore("meta").get(recordKey(space, key));
    req.onsuccess = () => { try { assertSpace(space); resolve(validRecord(req.result?.value) ? req.result.value : null); } catch (cause) { reject(cause); } };
    req.onerror = () => reject(new Error("Your saved share links could not be read. Try again."));
  });
}
export async function listShareRecords(space: string): Promise<{ key: string; record: ShareRecord }[]> {
  const db = await openDatabase();
  assertSpace(space);
  const prefix = recordKey(space, "");
  return new Promise((resolve, reject) => {
    const req = db.transaction("meta", "readonly").objectStore("meta").getAll(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
    req.onsuccess = () => {
      try {
        assertSpace(space);
        resolve(req.result.filter((entry) => validRecord(entry.value)).map((entry) => ({ key: entry.key.slice(prefix.length), record: entry.value as ShareRecord })).sort((a, b) => b.record.updatedAt - a.record.updatedAt));
      } catch (cause) { reject(cause); }
    };
    req.onerror = () => reject(new Error("Your saved share links could not be read. Try again."));
  });
}
async function remember(space: string, key: string, previous: ShareRecord, next: ShareRecord | null, metadataOnly = false): Promise<ShareRecord | null> {
  return editRecord(space, key, (current) => {
    if (current?.id !== previous.id || current?.token !== previous.token) throw new Error("This share link changed in another tab. Reopen Share.");
    if (!next) return null;
    // Requests from separate tabs can complete out of order. Confirmed times
    // come from the server; a pending reservation's browser clock does not.
    if (!current.pending && (next.pending || current.updatedAt > next.updatedAt)) return current;
    if (metadataOnly) return { ...current, pending: next.pending, expiresAt: next.expiresAt, expiry: next.expiry, updatedAt: next.updatedAt };
    return next;
  });
}

function sharedPiece(piece: Item): SharedPiece {
  const rating = "rating" in piece ? (piece as WishlistItem).rating : undefined;
  // Deliberate public whitelist: no IDs, sync fields, history, credentials, or model photo.
  return {
    name: piece.name, brand: piece.brand, category: piece.category, size: piece.size, color: piece.color,
    price: piece.price, currency: piece.currency, description: piece.description, purchaseUrl: piece.purchaseUrl,
    imageData: "", ...(rating !== undefined ? { rating } : {}),
  };
}
type ImageCompressor = (source: string, dimension: number, quality: number, transparency: boolean) => Promise<string>;
/** Build a bounded, self-contained snapshot. Original local photos stay untouched. */
export async function buildShareSnapshot(target: ShareTarget, compressor: ImageCompressor = compressImage): Promise<ShareSnapshot> {
  const pieces = piecesOf(target).filter((piece) => !piece.deletedAt);
  if (pieces.length > 300) throw new Error("A collection link can include up to 300 pieces. Share individual pieces instead.");
  if (!pieces.length && target.kind !== "outfit") throw new Error("Add a piece before creating a share link.");
  const snapshot: ShareSnapshot = {
    version: 1, kind: target.kind,
    title: target.kind === "wardrobe" ? "Wardrobe" : target.kind === "wishlist" ? "Wishlist" : target.kind === "piece" ? target.piece.name : target.outfit.name,
    pieces: pieces.map(sharedPiece),
  };
  const jobs: { source: string; dimension: number; apply: (data: string) => void }[] = [];
  for (const [index, piece] of pieces.entries()) {
    jobs.push({ source: imageSource(piece), dimension: target.kind === "piece" ? 1100 : 640, apply: (data) => { snapshot.pieces[index].imageData = data; } });
    // Collection snapshots use front photos; a single-piece link includes every view.
    if (target.kind === "piece") for (const side of ["back", "side"] as const) {
      const data = piece[`${side}ImageData`];
      const url = piece[`${side}ImageUrl`];
      if (data || url) jobs.push({ source: imageSource({ imageData: data, imageUrl: url ?? "" }), dimension: 1100, apply: (image) => { snapshot.pieces[index][`${side}ImageData`] = image; } });
    }
  }
  if (target.kind === "outfit") jobs.push({ source: target.outfit.imageData, dimension: 1400, apply: (data) => { snapshot.outfitImageData = data; } });
  const allowance = Math.floor((BODY_BUDGET - new TextEncoder().encode(JSON.stringify(snapshot)).length - 4096) / Math.max(1, jobs.length));
  if (allowance < 2000) throw new Error("This collection is too large for one link. Share individual pieces instead.");
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      if (!job.source) throw new Error("A piece has no saved photo. Add its photo before sharing.");
      let image = "";
      for (const [scale, quality] of [[1, .8], [.8, .68], [.6, .54], [.4, .42]]) {
        image = await compressor(job.source, Math.round(job.dimension * scale), quality, true);
        if (image.length <= allowance) break;
      }
      if (image.length > allowance) throw new Error("These photos are too large for one share link. Share individual pieces instead.");
      job.apply(image);
    }
  }));
  if (new TextEncoder().encode(JSON.stringify(snapshot)).length > BODY_BUDGET) throw new Error("This snapshot is too large to share.");
  return snapshot;
}

type RemoteRecord = { id?: string; exists?: boolean; expiresAt: number | null; updatedAt: number; expiry: ShareExpiry };
async function shareRequest(path: string, method: string, token?: string, body?: unknown): Promise<RemoteRecord | null> {
  const response = await fetch(path, {
    method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { "x-share-token": token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(45_000),
  });
  if (response.status === 410) return null;
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value?.error === "string" ? value.error : "This share link could not be updated. Try again.");
  return value;
}
function confirmed(record: ShareRecord, remote: RemoteRecord): ShareRecord {
  if (!(remote.expiresAt === null || Number.isFinite(remote.expiresAt)) || !Number.isFinite(remote.updatedAt) || !["7d", "30d", "never"].includes(remote.expiry)) throw new Error("The link's status could not be confirmed. Reopen Share to check it.");
  return { ...record, pending: false, expiresAt: remote.expiresAt, updatedAt: remote.updatedAt, expiry: remote.expiry };
}
export async function refreshShareRecord(space: string, key: string, record: ShareRecord): Promise<ShareRecord | null> {
  assertSpace(space);
  const remote = await shareRequest(`/api/share/${record.id}`, "GET", record.token);
  assertSpace(space);
  // Keep a pending capability even after a missing response: its create may still arrive.
  const next = remote ? confirmed(record, remote) : record.pending ? record : null;
  return remember(space, key, record, next, true);
}
export async function createShareLink(space: string, target: ShareTarget, expiry: ShareExpiry): Promise<ShareRecord> {
  assertSpace(space);
  if (!navigator.onLine) throw new Error("Connect to the internet to create a share link.");
  const snapshot = await buildShareSnapshot(target);
  assertSpace(space);
  const key = shareTargetKey(target);
  // Only a confirmed server 410 may retire an ownership record. A cached
  // deadline may be stale after another tab or an interrupted expiry change.
  const record = (await editRecord(space, key, (current) => current ?? {
    id: randomToken(16), token: randomToken(32), expiry, expiresAt: expiry === "never" ? null : Date.now() + (expiry === "7d" ? 7 : 30) * 86_400_000,
    updatedAt: Date.now(), sourceVersion: shareTargetVersion(target), pending: true, title: snapshot.title, kind: snapshot.kind,
  }))!;
  if (!record.pending) return record;
  // Ownership is durable before publication. Unknown network outcomes retain the token for retry/removal.
  const remote = await shareRequest("/api/share", "POST", undefined, { id: record.id, token: record.token, snapshot, expiry });
  if (!remote) throw new Error("This link was removed or expired. Remove it here, then create a new link.");
  assertSpace(space);
  const next = confirmed(record, remote);
  return (await remember(space, key, record, next))!;
}
export async function updateShareLink(space: string, target: ShareTarget, record: ShareRecord): Promise<ShareRecord> {
  assertSpace(space);
  const snapshot = await buildShareSnapshot(target);
  assertSpace(space);
  const remote = await shareRequest(`/api/share/${record.id}`, "PUT", record.token, { snapshot });
  if (!remote) throw new Error("This link was removed or expired. Reopen Share to create a new one.");
  assertSpace(space);
  const next = confirmed({ ...record, sourceVersion: shareTargetVersion(target), title: snapshot.title, kind: snapshot.kind }, remote);
  return (await remember(space, shareTargetKey(target), record, next))!;
}
export async function changeShareExpiry(space: string, key: string, record: ShareRecord, expiry: ShareExpiry): Promise<ShareRecord> {
  assertSpace(space);
  const remote = await shareRequest(`/api/share/${record.id}`, "PATCH", record.token, { expiry });
  if (!remote) throw new Error("This link was removed or expired. Reopen Share to create a new one.");
  assertSpace(space);
  const next = confirmed(record, remote);
  return (await remember(space, key, record, next, true))!;
}
export async function removeShareLink(space: string, key: string, record: ShareRecord): Promise<void> {
  assertSpace(space);
  await shareRequest(`/api/share/${record.id}`, "DELETE", record.token);
  assertSpace(space);
  await remember(space, key, record, null);
}
