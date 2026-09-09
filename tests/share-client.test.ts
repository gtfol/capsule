import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { buildShareSnapshot, changeShareExpiry, createShareLink, listShareRecords, readShareRecord, refreshShareRecord, removeShareLink, shareTargetKey, shareTargetVersion, updateShareLink, type ShareRecord, type ShareTarget } from "../src/lib/share-client";
import { openDatabase } from "../src/lib/db";
import { useWardrobe } from "../src/lib/store";
import type { Item } from "../src/lib/types";
import { pieceSourceKey } from "../src/lib/piece-identity";

const photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const piece: Item = { id: "local-only-id", name: "Shirt", brand: "Studio", category: "tops", size: "M", color: "Black", price: "40", currency: "USD", description: "Cotton shirt", purchaseUrl: "https://shop.example/shirt", imageUrl: "https://shop.example/front.png", imageData: photo, backImageData: photo, sideImageData: photo, createdAt: 1, updatedAt: 2 };
const compressor = async () => photo;

test("public snapshots whitelist chosen details and never include local state or credentials", async () => {
  const privatePiece = { ...piece, apiKey: "private-key", referencePhoto: "private-portrait", accountId: "private-account", priceHistory: [{ price: 9 }], sources: [{ url: "private-history" }] };
  const snapshot = await buildShareSnapshot({ kind: "piece", piece: privatePiece }, compressor);
  assert.equal(snapshot.pieces.length, 1);
  assert.equal(snapshot.pieces[0].backImageData, photo);
  assert.equal(snapshot.pieces[0].sideImageData, photo);
  assert.equal(snapshot.pieces[0].purchaseUrl, piece.purchaseUrl);
  assert.equal(snapshot.pieces[0].sourceKey, pieceSourceKey(piece));
  assert.doesNotMatch(JSON.stringify(snapshot), /local-only-id|private-|createdAt|updatedAt|priceHistory|sources/);
});

test("re-sharing a copied piece retains its source identity", async () => {
  const copy = { ...piece, id: "new-copy-id", sourceKey: pieceSourceKey(piece) };
  const shared = await buildShareSnapshot({ kind: "piece", piece: copy }, compressor);
  assert.equal(shared.pieces[0].sourceKey, pieceSourceKey(piece));
  assert.doesNotMatch(JSON.stringify(shared), /local-only-id|new-copy-id/);
});

test("wardrobe and wishlist snapshots include all active pieces with front photos only", async () => {
  for (const kind of ["wardrobe", "wishlist"] as const) {
    const target: ShareTarget = { kind, pieces: [piece, { ...piece, id: "second", name: "Second" }, { ...piece, deletedAt: 10 }] };
    const snapshot = await buildShareSnapshot(target, compressor);
    assert.equal(snapshot.kind, kind);
    assert.deepEqual(snapshot.pieces.map((item) => item.name), ["Shirt", "Second"]);
    assert.equal(snapshot.pieces[0].backImageData, undefined);
    assert.equal(snapshot.pieces[0].sideImageData, undefined);
  }
});

test("outfits share the selected rendered image, including when original pieces were removed", async () => {
  const outfit = { id: "private-outfit-id", name: "Outfit 01", imageData: photo, itemIds: [piece.id], createdAt: 1, updatedAt: 2 };
  for (const pieces of [[piece], []]) {
    const snapshot = await buildShareSnapshot({ kind: "outfit", outfit, pieces }, compressor);
    assert.equal(snapshot.outfitImageData, photo);
    assert.equal(snapshot.pieces.length, pieces.length);
    assert.doesNotMatch(JSON.stringify(snapshot), /private-outfit-id|itemIds/);
  }
});

test("empty, oversized, and missing-photo selections fail without silently dropping pieces", async () => {
  await assert.rejects(buildShareSnapshot({ kind: "wardrobe", pieces: [] }, compressor), /Add a piece/);
  await assert.rejects(buildShareSnapshot({ kind: "wishlist", pieces: Array(301).fill(piece) }, compressor), /300 pieces/);
  await assert.rejects(buildShareSnapshot({ kind: "piece", piece: { ...piece, imageData: undefined, imageUrl: "" } }, compressor), /no saved photo/);
  await assert.rejects(buildShareSnapshot({ kind: "piece", piece }, async () => "x".repeat(4_000_000)), /too large/);
});

function installBrowser() {
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
  Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  Object.defineProperty(globalThis, "createImageBitmap", { value: async () => ({ width: 1, height: 1, close() {} }), configurable: true });
  Object.defineProperty(globalThis, "document", { value: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => photo }) }, configurable: true });
  useWardrobe.setState({ space: "guest" });
}

test("ownership is persisted before publication and retained after an uncertain creation", async () => {
  installBrowser();
  const target: ShareTarget = { kind: "wardrobe", pieces: [piece] };
  const key = shareTargetKey(target);
  const originalFetch = globalThis.fetch;
  let postedId = "";
  let requests = 0;
  try {
    globalThis.fetch = (async (url, init) => {
      if (String(url).startsWith("data:")) return new Response(new Blob(["image"], { type: "image/png" }));
      requests++;
      const saved = await readShareRecord("guest", key);
      assert.ok(saved?.token);
      if (init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        assert.equal(body.id, saved.id);
        assert.equal(body.token, saved.token);
        assert.equal(body.expiry, "7d");
        postedId ||= body.id;
        assert.equal(body.id, postedId, "retry must reuse the original ownership capability");
        if (requests === 1) throw new Error("Network interrupted");
        return Response.json({ id: body.id, updatedAt: 100, expiresAt: 100 + 7 * 86_400_000, expiry: "7d" });
      }
      if (init?.method === "DELETE") return Response.json({ ok: true });
      return Response.json({ error: "Missing" }, { status: 410 });
    }) as typeof fetch;
    await assert.rejects(createShareLink("guest", target, "7d"), /Network interrupted/);
    const pending = await readShareRecord("guest", key);
    assert.ok(pending?.pending);
    assert.equal((await refreshShareRecord("guest", key, pending))?.pending, true, "missing pending share must keep token until explicitly removed");
    const confirmed = await createShareLink("guest", target, "7d");
    assert.equal(confirmed.id, postedId);
    assert.equal(confirmed.pending, false);
    assert.equal(confirmed.expiry, "7d");
    assert.equal((await createShareLink("guest", target, "never")).id, postedId, "a cached elapsed deadline must not overwrite ownership");
    assert.equal((await listShareRecords("guest"))[0].record.title, "Wardrobe");
    await removeShareLink("guest", key, confirmed);
    assert.equal(await readShareRecord("guest", key), null);
    useWardrobe.setState({ space: "account:other" });
    await assert.rejects(createShareLink("guest", target, "7d"), /active wardrobe changed/);
    assert.deepEqual(await listShareRecords("account:other"), []);
  } finally {
    globalThis.fetch = originalFetch;
    useWardrobe.setState({ space: "guest" });
  }
});

test("late metadata and snapshot responses cannot roll back newer same-link state", async () => {
  installBrowser();
  const originalFetch = globalThis.fetch;
  const oldTarget: ShareTarget = { kind: "piece", piece: { ...piece, id: "race-piece" } };
  const newTarget: ShareTarget = { kind: "piece", piece: { ...oldTarget.piece, name: "Newly shared shirt", updatedAt: 3 } };
  const key = shareTargetKey(oldTarget);
  const initial: ShareRecord = {
    id: "AAAAAAAAAAAAAAAAAAAAAA", token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", pending: false,
    expiry: "7d", expiresAt: 100 + 7 * 86_400_000, updatedAt: 100,
    sourceVersion: shareTargetVersion(oldTarget), title: oldTarget.piece.name, kind: "piece",
  };
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put({ key: `guest|share-link|${key}`, value: initial });
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  let metadata = { updatedAt: 300, expiresAt: null as number | null, expiry: "never" };
  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("data:")) return new Response(new Blob(["image"], { type: "image/png" }));
      if (init?.method === "DELETE") return Response.json({ ok: true });
      if (init?.method === "PUT") assert.deepEqual(Object.keys(JSON.parse(String(init.body))), ["snapshot"]);
      return Response.json(metadata);
    };
    const newest = await updateShareLink("guest", newTarget, initial);
    assert.equal(newest.sourceVersion, shareTargetVersion(newTarget));
    metadata = { updatedAt: 100, expiresAt: initial.expiresAt, expiry: "7d" };
    assert.deepEqual(await refreshShareRecord("guest", key, initial), newest, "a late GET returns effective newer state");
    metadata = { updatedAt: 400, expiresAt: 400 + 30 * 86_400_000, expiry: "30d" };
    const patched = await changeShareExpiry("guest", key, initial, "30d");
    assert.equal(patched.updatedAt, 400); assert.equal(patched.expiry, "30d");
    assert.equal(patched.sourceVersion, newest.sourceVersion); assert.equal(patched.title, newest.title); assert.equal(patched.kind, newest.kind);
    metadata = { updatedAt: 200, expiresAt: initial.expiresAt, expiry: "7d" };
    assert.deepEqual(await updateShareLink("guest", oldTarget, initial), patched, "a late PUT cannot restore older content metadata");
    metadata = { updatedAt: 500, expiresAt: null, expiry: "never" };
    const refreshed = await refreshShareRecord("guest", key, initial);
    assert.equal(refreshed?.sourceVersion, newest.sourceVersion); assert.equal(refreshed?.title, newest.title);
    assert.equal(refreshed?.expiry, "never");
    assert.deepEqual(await readShareRecord("guest", key), refreshed);
    globalThis.fetch = async () => Response.json({ error: "Missing" }, { status: 410 });
    assert.deepEqual(await refreshShareRecord("guest", key, { ...initial, pending: true, updatedAt: Date.now() }), refreshed, "a stale unconfirmed reservation cannot replace its confirmation");
  } finally {
    globalThis.fetch = async () => Response.json({ ok: true });
    const current = await readShareRecord("guest", key);
    if (current) await removeShareLink("guest", key, current);
    globalThis.fetch = originalFetch;
  }
});
