import assert from "node:assert/strict";
import test from "node:test";
import { createLoader, createSerializer } from "nuqs/server";
import { CAPSULE_VIEWS, navigationParsers, navigationQuery } from "../src/lib/navigation";

const read = createLoader(navigationParsers);
const write = createSerializer(navigationParsers);

test("all four navigation views survive a URL round trip, with a clean Wardrobe default", () => {
  for (const view of CAPSULE_VIEWS) {
    const url = write("/", navigationQuery(view));
    assert.equal(read(new URL(url, "https://capsule.example")).view, view);
    assert.equal(url, view === "wardrobe" ? "/" : `/?view=${view}`);
  }
});

test("missing, empty and invalid navigation values fall back to Wardrobe", () => {
  for (const search of ["", "?view=", "?view=unknown", "?view=OUTFITS", "?view=javascript%3Aalert(1)"]) {
    assert.equal(read(search).view, "wardrobe");
  }
  assert.equal(read("?view=add&to=other").to, "wardrobe");
});

test("Add URLs preserve their destination and leaving Add clears only its navigation parameter", () => {
  const add = write("/?campaign=one#main", navigationQuery("add", "wishlist"));
  assert.equal(add, "/?campaign=one&view=add&to=wishlist#main");
  assert.deepEqual(read(new URL(add, "https://capsule.example")), { view: "add", to: "wishlist", import: null, piece: null });
  assert.equal(write(add, navigationQuery("outfits")), "/?campaign=one&view=outfits#main");
  assert.equal(write(add, navigationQuery("wardrobe")), "/?campaign=one#main");
});

test("saved navigation entries restore Add destinations when traversed in either direction", () => {
  const history = [navigationQuery("wardrobe"), navigationQuery("wishlist"), navigationQuery("add", "wishlist"), navigationQuery("outfits")].map((state) => write("/", state));
  const restored = [...history.toReversed(), ...history].map((url) => read(new URL(url, "https://capsule.example")));
  assert.deepEqual(restored.map((state) => state.view), ["outfits", "add", "wishlist", "wardrobe", "wardrobe", "wishlist", "add", "outfits"]);
  assert.equal(restored[1].to, "wishlist");
  assert.equal(restored[6].to, "wishlist");
});

test("extension links open Add with the chosen destination and intact product URL", () => {
  const productUrl = "https://shop.example/products/coat?variant=123&color=navy#details";
  for (const destination of ["wardrobe", "wishlist"]) {
    const handoff = new URL("https://capsule.gtfol.dev/");
    handoff.search = new URLSearchParams({ view: "add", to: destination, import: productUrl }).toString();
    assert.deepEqual(read(handoff), { view: "add", to: destination, import: productUrl, piece: null });
    const consumed = write(handoff.pathname + handoff.search, navigationQuery(destination as "wardrobe" | "wishlist"));
    assert.equal(read(new URL(consumed, handoff)).import, null);
    assert.equal(read(new URL(consumed, handoff)).view, destination);
  }
});

test("existing pieces can be opened directly and changing views clears the selection", () => {
  const url = "/?view=wishlist&piece=existing-piece";
  assert.equal(read(url).piece, "existing-piece");
  assert.equal(write(url, navigationQuery("wardrobe")), "/");
  assert.equal(write(url, navigationQuery("outfits")), "/?view=outfits");
});
