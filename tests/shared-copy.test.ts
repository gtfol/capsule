import assert from "node:assert/strict";
import test from "node:test";
import { copySharedPieces, readSharedCopyIntent, sharedCopyReceipt, sharedCopyReturnUrl, sharedSelectionMatches, wishlistCopyPrice, type SharedCopyDependencies } from "../src/lib/shared-copy";
import type { SharedPiece, ShareSnapshot } from "../src/lib/share-types";
import type { Item, WishlistItem } from "../src/lib/types";

const piece: SharedPiece = { name: "Shirt", brand: "Studio", category: "tops", size: "M", color: "White", price: "19.90", currency: "USD", description: "Cotton shirt", purchaseUrl: "https://shop.example/shirt", imageData: "data:image/png;base64,Zm9v", backImageData: "data:image/png;base64,YmFy", sideImageData: "data:image/png;base64,YmF6", rating: 4.5 };
const shown: ShareSnapshot = { version: 1, kind: "wardrobe", title: "Wardrobe", pieces: [piece, { ...piece, name: "Trousers", category: "bottoms" }] };
function setup(snapshot = shown) {
  const calls: string[] = [];
  const persisted: Array<Item | WishlistItem> = [];
  const receipts = new Map<string, string[]>();
  const state = { userId: "alice" as string | null, space: "account:alice" };
  let id = 0;
  const deps: SharedCopyDependencies = {
    refreshSession: async () => { calls.push("refresh"); },
    context: () => state,
    fetchSnapshot: async () => { calls.push("server-gate"); return { userId: "alice", snapshot }; },
    cacheImages: async (image) => { calls.push(`photo:${image.name}`); return { imageData: image.imageData, backImageData: image.backImageData, sideImageData: image.sideImageData }; },
    persist: async (space, collection, records, receipt, guard) => {
      guard(); calls.push(`commit:${space}:${collection}`);
      if (receipts.has(receipt)) return { count: 0, skipped: records.length, alreadyAdded: true, itemIds: receipts.get(receipt)! };
      receipts.set(receipt, records.map((record) => record.id)); persisted.push(...records);
      return { count: records.length, skipped: 0, alreadyAdded: false, itemIds: records.map((record) => record.id) };
    },
    uuid: () => `new-local-id-${++id}`,
    now: () => 12345,
  };
  const input = { shareId: "abcdefghijklmnopqrstuv", shownSnapshot: snapshot, selection: "all" as const, destination: "wardrobe" as const, expectedUserId: "alice" };
  return { deps, calls, state, persisted, input };
}

test("shared copy return intent preserves destination and selection but never adds by itself", () => {
  const url = sharedCopyReturnUrl("https://capsule.example/share/id?keep=1", { destination: "wishlist", selection: 1 });
  assert.equal(new URL(url).searchParams.get("keep"), "1");
  assert.deepEqual(readSharedCopyIntent(url, 2), { destination: "wishlist", selection: 1 });
  assert.deepEqual(readSharedCopyIntent("https://capsule.example/?addTo=wardrobe&piece=all", 2), { destination: "wardrobe", selection: "all" });
  for (const value of ["-1", "2", "1.5", "01", "999999999999999999999", "nope"]) assert.equal(readSharedCopyIntent(`https://capsule.example/?addTo=wishlist&piece=${value}`, 2), null);
  assert.equal(readSharedCopyIntent("https://capsule.example/?addTo=outfits&piece=0", 2), null);
  assert.equal(readSharedCopyIntent("https://capsule.example/?addTo=wardrobe&piece=all", 0), null);
});

test("guest and changed account fail before any shared photos or local records are touched", async () => {
  const fixture = setup(); fixture.state.userId = null;
  await assert.rejects(copySharedPieces(fixture.input, fixture.deps), /account changed/);
  assert.deepEqual(fixture.calls, ["refresh"]);
  fixture.state.userId = "alice";
  fixture.deps.refreshSession = async () => { fixture.state.userId = "bob"; fixture.state.space = "account:bob"; };
  await assert.rejects(copySharedPieces(fixture.input, fixture.deps), /account changed/);
  assert.equal(fixture.persisted.length, 0);
});

test("expired or revoked share stops copying before image preparation", async () => {
  const fixture = setup();
  fixture.deps.fetchSnapshot = async () => { throw new Error("This link has expired or been removed."); };
  await assert.rejects(copySharedPieces(fixture.input, fixture.deps), /expired/);
  assert.deepEqual(fixture.calls, ["refresh"]);
  assert.equal(fixture.persisted.length, 0);
});

test("copy requires the currently visible selected pieces after the fresh server gate", async () => {
  const fixture = setup();
  fixture.deps.fetchSnapshot = async () => ({ userId: "alice", snapshot: { ...shown, pieces: [...shown.pieces].reverse() } });
  await assert.rejects(copySharedPieces({ ...fixture.input, selection: 0 }, fixture.deps), /Refresh the page/);
  assert.equal(fixture.persisted.length, 0);
  const unrelated = { ...shown, pieces: [piece, { ...shown.pieces[1], price: "50" }] };
  assert.equal(sharedSelectionMatches(shown, unrelated, 0), true);
  assert.equal(sharedSelectionMatches(shown, unrelated, "all"), false);
});

test("copies outfit clothing into owned records without the rendered person or owner rating", async () => {
  const snapshot: ShareSnapshot = { ...shown, kind: "outfit", outfitImageData: "never-import-this-rendered-person" };
  const fixture = setup(snapshot);
  assert.deepEqual(await copySharedPieces(fixture.input, fixture.deps), { count: 2, skipped: 0, alreadyAdded: false, itemIds: ["new-local-id-1", "new-local-id-2"] });
  assert.equal(fixture.persisted.length, 2);
  assert.equal(fixture.persisted[0].id, "new-local-id-1");
  assert.equal(fixture.persisted[0].createdAt, 12345);
  assert.equal(fixture.persisted[0].imageUrl, "");
  assert.equal(fixture.persisted[0].backImageData, piece.backImageData);
  assert.equal(fixture.persisted[0].sideImageData, piece.sideImageData);
  assert.equal("rating" in fixture.persisted[0], false);
  assert.ok(!JSON.stringify(fixture.persisted).includes(snapshot.outfitImageData!));
  assert.deepEqual(fixture.calls.slice(0, 2), ["refresh", "server-gate"]);
});

test("wishlist copies reset owner ratings and history and support pieces without a retail link", async () => {
  const snapshot: ShareSnapshot = { ...shown, pieces: [{ ...piece, purchaseUrl: "", price: "$1,299.50", currency: "usd" }] };
  const fixture = setup(snapshot);
  await copySharedPieces({ ...fixture.input, destination: "wishlist" }, fixture.deps);
  const copied = fixture.persisted[0] as WishlistItem;
  assert.equal(copied.rating, null); assert.deepEqual(copied.priceHistory, []); assert.deepEqual(copied.sources, []);
  assert.equal(copied.purchaseUrl, ""); assert.equal(copied.price, "1299.5"); assert.equal(copied.currency, "USD");
  assert.equal(copied.link_broken, false); assert.equal(copied.currentSourceUrl, "");
  assert.deepEqual(wishlistCopyPrice("thrifted", "dollars"), { price: "", currency: "" });
  assert.deepEqual(wishlistCopyPrice("20 EUR", "eur"), { price: "20", currency: "EUR" });
  assert.deepEqual(wishlistCopyPrice("1.299,00", "EUR"), { price: "", currency: "EUR" });
  assert.deepEqual(wishlistCopyPrice("new 100", "USD"), { price: "", currency: "USD" });
});

test("a failed photo or account switch cancels the whole collection before its atomic commit", async () => {
  const fixture = setup();
  fixture.deps.cacheImages = async (image) => {
    if (image.name === "Trousers") throw new Error("Photo too large.");
    return { imageData: image.imageData };
  };
  await assert.rejects(copySharedPieces(fixture.input, fixture.deps), /Photo too large/);
  assert.equal(fixture.persisted.length, 0);
  fixture.deps.cacheImages = async (image) => { fixture.state.space = "account:bob"; return { imageData: image.imageData }; };
  await assert.rejects(copySharedPieces(fixture.input, fixture.deps), /account changed/);
  assert.equal(fixture.persisted.length, 0);
});

test("retry receipts are stable across generated IDs and JSON property order, and isolated by destination", async () => {
  const fixture = setup();
  await copySharedPieces(fixture.input, fixture.deps);
  assert.deepEqual(await copySharedPieces(fixture.input, fixture.deps), { count: 0, skipped: 2, alreadyAdded: true, itemIds: ["new-local-id-1", "new-local-id-2"] });
  assert.equal(fixture.persisted.length, 2);
  const reordered = Object.fromEntries(Object.entries(piece).reverse()) as unknown as SharedPiece;
  assert.equal(await sharedCopyReceipt("share", "wardrobe", [piece]), await sharedCopyReceipt("share", "wardrobe", [reordered]));
  assert.notEqual(await sharedCopyReceipt("share", "wardrobe", [piece]), await sharedCopyReceipt("share", "wishlist", [piece]));
});

test("copies retain source identity and changed identities require reviewing the fresh snapshot", async () => {
  const sourceKey = "a".repeat(64);
  const snapshot = { ...shown, pieces: [{ ...piece, sourceKey }] };
  const fixture = setup(snapshot);
  await copySharedPieces(fixture.input, fixture.deps);
  assert.equal(fixture.persisted[0].sourceKey, sourceKey);
  const changed = { ...snapshot, pieces: [{ ...piece, sourceKey: "b".repeat(64) }] };
  assert.equal(sharedSelectionMatches(snapshot, changed, 0), false);
});
