import { CAPSULE_URL } from "./config.mjs";

const MAX_URL_LENGTH = 8192;
const DESTINATIONS = new Set(["wardrobe", "wishlist"]);

/** @param {string} value */
function appURL(value) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password) {
    throw new Error("Capsule is not configured correctly.");
  }
  return url;
}

/** @param {unknown} value @param {string} [capsuleURL] */
export function readProductURL(value, capsuleURL = CAPSULE_URL) {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH || !value.trim()) {
    throw new Error("Open a product page to add it to Capsule.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Open a product page to add it to Capsule.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > MAX_URL_LENGTH) {
    throw new Error("Open a product page to add it to Capsule.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const capsuleHostname = appURL(capsuleURL).hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === capsuleHostname || hostname === "capsule.gtfol.dev" || hostname.endsWith(".capsule.gtfol.dev")) {
    throw new Error("Open a shopping website to add an item.");
  }
  return url;
}

/** @param {string} productURL @param {string} destination @param {string} [capsuleURL] */
export function buildHandoffURL(productURL, destination, capsuleURL = CAPSULE_URL) {
  if (!DESTINATIONS.has(destination)) throw new Error("Choose Wardrobe or Wishlist.");
  const product = readProductURL(productURL, capsuleURL);
  const target = appURL(capsuleURL);
  target.pathname = "/";
  target.search = "";
  target.hash = "";
  target.searchParams.set("view", "add");
  target.searchParams.set("to", destination);
  target.searchParams.set("import", product.href);
  return target.href;
}

/**
 * @typedef {{query: (query: {active: boolean, currentWindow: boolean}) => Promise<Array<{url?: string, title?: string}>>, create: (options: {url: string, active: boolean}) => Promise<unknown>}} TabsAPI
 * @param {TabsAPI} tabs
 * @param {string} [capsuleURL]
 */
export function createPopupController(tabs, capsuleURL = CAPSULE_URL) {
  /** @type {{url: string, hostname: string, title: string} | null} */
  let page = null;
  let opening = false;
  return {
    async load() {
      page = null;
      let current;
      try {
        [current] = await tabs.query({ active: true, currentWindow: true });
      } catch {
        throw new Error("Unable to read this page. Reopen the extension and try again.");
      }
      const url = readProductURL(current?.url, capsuleURL);
      page = {
        url: url.href,
        hostname: url.hostname.replace(/^www\./, ""),
        title: current?.title?.trim() || url.hostname,
      };
      return page;
    },
    /** @param {string} destination */
    async open(destination) {
      if (opening) return false;
      if (!page) throw new Error("Open a product page to add it to Capsule.");
      const url = buildHandoffURL(page.url, destination, capsuleURL);
      opening = true;
      try {
        await tabs.create({ url, active: true });
        return true;
      } catch {
        throw new Error("Couldn't open Capsule. Try again.");
      } finally {
        opening = false;
      }
    },
  };
}
