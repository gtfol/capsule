import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildHandoffURL, createPopupController, readProductURL } from "../extension/handoff.mjs";

const productURL = "https://shop.example/products/linen-shirt?variant=123&color=off%20white#size-m";

test("extension handoffs preserve the complete listing URL and explicit save destination", () => {
  for (const destination of ["wardrobe", "wishlist"]) {
    const handoff = new URL(buildHandoffURL(productURL, destination));
    assert.equal(handoff.origin, "https://capsule.gtfol.dev");
    assert.equal(handoff.pathname, "/");
    assert.equal(handoff.searchParams.get("view"), "add");
    assert.equal(handoff.searchParams.get("to"), destination);
    assert.equal(handoff.searchParams.get("import"), productURL);
    assert.equal(handoff.hash, "");
    assert.deepEqual([...handoff.searchParams.keys()], ["view", "to", "import"]);
  }
  assert.throws(() => buildHandoffURL(productURL, "outfits"), /Choose Wardrobe or Wishlist/);
});

test("extension URL validation rejects privileged pages, credentials, malformed and oversized URLs", () => {
  for (const value of [
    undefined, null, 42, "", "  ", "/products/shirt", "not a URL",
    "chrome://extensions", "brave://newtab", "about:blank", "file:///tmp/item.html",
    "chrome-extension://extensionid/popup.html", "javascript:alert(1)", "data:text/html,shirt",
    "ftp://shop.example/item", "https://person:secret@shop.example/item",
    "https://secret@shop.example/item", `https://shop.example/${"a".repeat(8192)}`,
    `https://shop.example/${"é".repeat(2000)}`,
  ]) {
    assert.throws(() => readProductURL(value), /Open a product page/);
  }
  assert.equal(readProductURL("http://shop.example/item").href, "http://shop.example/item");
});

test("extension rejects Capsule itself, including normalized and local development destinations", () => {
  for (const value of [
    "https://capsule.gtfol.dev/", "https://CAPSULE.GTFOL.DEV/?view=wishlist",
    "https://capsule.gtfol.dev./", "https://preview.capsule.gtfol.dev/",
  ]) assert.throws(() => readProductURL(value), /Open a shopping website/);
  assert.throws(() => readProductURL("http://127.0.0.1:3103/?view=add", "http://127.0.0.1:3103/"), /Open a shopping website/);
  assert.equal(readProductURL("https://capsule.gtfol.dev.shop.example/shirt").hostname, "capsule.gtfol.dev.shop.example");
});

test("development handoffs use a configured local server without inheriting stale queries or paths", () => {
  const handoff = new URL(buildHandoffURL(productURL, "wishlist", "http://127.0.0.1:3103/old?view=outfits#old"));
  assert.equal(handoff.origin, "http://127.0.0.1:3103");
  assert.equal(handoff.pathname, "/");
  assert.equal(handoff.searchParams.get("to"), "wishlist");
  assert.equal(handoff.searchParams.get("import"), productURL);
  assert.equal(handoff.hash, "");
  assert.throws(() => buildHandoffURL(productURL, "wardrobe", "http://capsule.example/"), /not configured correctly/);
  assert.throws(() => buildHandoffURL(productURL, "wardrobe", "https://user:secret@capsule.example/"), /not configured correctly/);
});

test("popup reads only the active tab and opens its confirmed destination in a new active tab", async () => {
  const queries: unknown[] = [];
  const creations: unknown[] = [];
  const popup = createPopupController({
    query: async (query) => { queries.push(query); return [{ url: productURL, title: "  Linen shirt  " }]; },
    create: async (options) => { creations.push(options); },
  });
  await assert.rejects(popup.open("wardrobe"), /Open a product page/);
  assert.deepEqual(await popup.load(), { url: productURL, hostname: "shop.example", title: "Linen shirt" });
  assert.deepEqual(queries, [{ active: true, currentWindow: true }]);
  assert.equal(creations.length, 0);
  assert.equal(await popup.open("wishlist"), true);
  assert.deepEqual(creations, [{ url: buildHandoffURL(productURL, "wishlist"), active: true }]);
});

test("popup exposes useful safe messages for unavailable tabs and lookup errors", async () => {
  for (const tabs of [[], [{}], [{ url: "brave://settings/" }]]) {
    const popup = createPopupController({ query: async () => tabs, create: async () => assert.fail("must not open a tab") });
    await assert.rejects(popup.load(), /Open a product page/);
    await assert.rejects(popup.open("wardrobe"), /Open a product page/);
  }
  const popup = createPopupController({
    query: async () => { throw new Error("sensitive browser error"); },
    create: async () => assert.fail("must not open a tab"),
  });
  await assert.rejects(popup.load(), { message: "Unable to read this page. Reopen the extension and try again." });
});

test("popup clears a previously loaded tab if a subsequent read fails", async () => {
  let queryCount = 0;
  const popup = createPopupController({
    query: async () => ++queryCount === 1 ? [{ url: productURL }] : [],
    create: async () => assert.fail("must not open a stale tab"),
  });
  assert.equal((await popup.load()).title, "shop.example");
  await assert.rejects(popup.load(), /Open a product page/);
  await assert.rejects(popup.open("wardrobe"), /Open a product page/);
});

test("popup prevents duplicate handoffs while the browser is opening a tab", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let created = 0;
  const popup = createPopupController({
    query: async () => [{ url: productURL }],
    create: async () => { created++; await pending; },
  });
  await popup.load();
  const first = popup.open("wardrobe");
  assert.equal(await popup.open("wishlist"), false);
  assert.equal(created, 1);
  release();
  assert.equal(await first, true);
});

test("popup allows retry after opening fails without exposing the browser error", async () => {
  let attempts = 0;
  const popup = createPopupController({
    query: async () => [{ url: productURL }],
    create: async () => { if (++attempts === 1) throw new Error("private browser details"); },
  });
  await popup.load();
  await assert.rejects(popup.open("wishlist"), { message: "Couldn't open Capsule. Try again." });
  assert.equal(await popup.open("wishlist"), true);
  assert.equal(attempts, 2);
});

test("Manifest V3 package has only activeTab permission and includes all local popup assets and PNG icons", async () => {
  const file = (path: string) => readFile(new URL(`../extension/${path}`, import.meta.url));
  const manifest = JSON.parse((await file("manifest.json")).toString());
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["activeTab"]);
  for (const field of ["host_permissions", "optional_permissions", "optional_host_permissions", "background", "content_scripts", "externally_connectable", "web_accessible_resources"]) {
    assert.equal(manifest[field], undefined, `unexpected ${field}`);
  }
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
  const popup = (await file(manifest.action.default_popup)).toString();
  assert.match(popup, /<script src="popup\.mjs" type="module"><\/script>/);
  assert.doesNotMatch(popup, /(?:src|href)="https?:/);
  for (const name of ["popup.css", "popup.mjs", "handoff.mjs", "config.mjs"]) assert.ok((await file(name)).length > 0);
  const font = await file("fonts/lato-regular-latin.woff2");
  assert.equal(font.subarray(0, 4).toString(), "wOF2");
  const css = (await file("popup.css")).toString();
  assert.match(css, /@font-face\s*\{[^}]*font-family: Lato;[^}]*font-weight: 400;[^}]*url\("fonts\/lato-regular-latin\.woff2"\)/);
  assert.doesNotMatch(css, /(?:@import|url\()\s*["']?https?:/);
  const fontLicense = (await file("fonts/OFL.txt")).toString();
  assert.match(fontLicense, /Copyright.*tyPoland Lukasz Dziedzic/);
  assert.match(fontLicense, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(fontLicense, /OTHER DEALINGS IN THE FONT SOFTWARE\./);
  for (const [size, filename] of Object.entries(manifest.icons) as [string, string][]) {
    const icon = await file(filename);
    assert.equal(icon.subarray(1, 4).toString(), "PNG");
    assert.equal(icon.readUInt32BE(16), Number(size));
    assert.equal(icon.readUInt32BE(20), Number(size));
  }
});
