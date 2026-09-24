import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

export class SafeFetchError extends Error {
  constructor(
    message: string,
    public readonly code: "INVALID_URL" | "BLOCKED_URL" | "TIMEOUT" | "TOO_LARGE" | "FETCH_FAILED" | "TOO_MANY_REDIRECTS",
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

type Address = { address: string; family: number };
type Resolver = (hostname: string) => Promise<Address[]>;

function ipv6Number(address: string): bigint {
  const [left, right] = address.toLowerCase().split("::");
  const start = left ? left.split(":") : [];
  const end = right ? right.split(":") : [];
  const groups = right !== undefined ? [...start, ...Array(8 - start.length - end.length).fill("0"), ...end] : start;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

/** Deliberately accepts only globally routable unicast addresses. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) !== 6 || address.includes(".")) return false;
  const value = ipv6Number(address);
  const prefix = (base: string, bits: number) => value >> BigInt(128 - bits) === ipv6Number(base) >> BigInt(128 - bits);
  // This also excludes loopback, link-local, ULA, mapped IPv4, NAT64, and multicast.
  return prefix("2000::", 3) && !prefix("2001::", 23) && !prefix("2001:db8::", 32) &&
    !prefix("2002::", 16) && !prefix("3fff::", 20);
}

export function validatePublicUrl(input: string | URL): URL {
  let url: URL;
  try {
    if (String(input).length > 8192) throw new Error("URL length");
    url = new URL(input);
  } catch {
    throw new SafeFetchError("Enter a valid product URL.", "INVALID_URL");
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new SafeFetchError("Use a public HTTP or HTTPS link without credentials or a custom port.", "INVALID_URL");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!hostname || hostname === "localhost" || !hostname.includes(".") && !isIP(hostname) ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)$/.test(hostname) ||
    isIP(hostname) && !isPublicAddress(hostname)) {
    throw new SafeFetchError("This link does not point to a public website.", "BLOCKED_URL");
  }
  url.hash = "";
  return url;
}

/** All answers must be public; the selected address is then used directly by the socket. */
export async function resolvePublicTarget(input: string | URL, resolver: Resolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true })) {
  const url = validatePublicUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: Address[];
  try {
    addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolver(hostname);
  } catch {
    throw new SafeFetchError("This website could not be reached. Check the link and try again.", "FETCH_FAILED");
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new SafeFetchError("This link does not point to a public website.", "BLOCKED_URL");
  }
  // Prefer IPv4 for runtimes without an IPv6 route. There is no second DNS lookup.
  const address = addresses.find((entry) => entry.family === 4) ?? addresses[0];
  return { url, hostname, ...address };
}

export type SafeFetchOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string;
};

export type SafeFetchResult = {
  url: string;
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  contentType: string;
};

function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new SafeFetchError("This website took too long to respond. Try again.", "TIMEOUT")), Math.max(1, milliseconds));
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function requestTarget(target: Awaited<ReturnType<typeof resolvePublicTarget>>, options: Required<SafeFetchOptions>): Promise<SafeFetchResult> {
  return new Promise((resolve, reject) => {
    const { url, address, family, hostname } = target;
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request({
      protocol: url.protocol,
      hostname: address,
      family,
      port: url.protocol === "https:" ? 443 : 80,
      path: url.pathname + url.search,
      method: "GET",
      agent: false,
      servername: isIP(hostname) ? undefined : hostname,
      maxHeaderSize: 32 * 1024,
      headers: {
        Host: url.host,
        Accept: options.accept,
        "Accept-Encoding": "gzip, deflate, br",
        "User-Agent": "Mozilla/5.0 (compatible; Capsule/1.0; +https://capsule.gtfol.dev)",
      },
    });
    let settled = false;
    const timer = setTimeout(() => fail(new SafeFetchError("This website took too long to respond. Try again.", "TIMEOUT")), options.timeoutMs);
    function fail(error: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      reject(error instanceof SafeFetchError ? error : new SafeFetchError("This website could not be reached. Try again.", "FETCH_FAILED"));
    }
    req.on("error", fail);
    req.on("response", (response) => {
      const status = response.statusCode ?? 502;
      const finish = (body: Buffer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ url: url.href, status, headers: response.headers, body, contentType: String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() });
      };
      if ([301, 302, 303, 307, 308].includes(status)) {
        finish(Buffer.alloc(0));
        response.destroy();
        return;
      }
      if (Number(response.headers["content-length"]) > options.maxBytes) {
        fail(new SafeFetchError("This page or image is too large to import.", "TOO_LARGE"));
        response.destroy();
        return;
      }
      const encoding = String(response.headers["content-encoding"] ?? "identity").toLowerCase();
      const decoder = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : null;
      if (encoding !== "identity" && !decoder) {
        fail(new SafeFetchError("This website returned an unsupported response.", "FETCH_FAILED"));
        response.destroy();
        return;
      }
      const stream = decoder ? response.pipe(decoder) : response;
      const chunks: Buffer[] = [];
      let bytes = 0;
      let wireBytes = 0;
      response.on("data", (chunk: Buffer) => {
        wireBytes += chunk.length;
        if (wireBytes > options.maxBytes) {
          fail(new SafeFetchError("This page or image is too large to import.", "TOO_LARGE"));
          stream.destroy();
        }
      });
      response.on("error", fail);
      response.on("aborted", () => fail(new SafeFetchError("This website ended its response early. Try again.", "FETCH_FAILED")));
      stream.on("error", fail);
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > options.maxBytes) {
          fail(new SafeFetchError("This page or image is too large to import.", "TOO_LARGE"));
          stream.destroy();
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      stream.on("end", () => finish(Buffer.concat(chunks)));
    });
    req.end();
  });
}

export async function safeFetch(input: string | URL, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const config: Required<SafeFetchOptions> = {
    maxBytes: Math.min(Math.max(options.maxBytes ?? 5 * 1024 * 1024, 1), 16 * 1024 * 1024),
    timeoutMs: Math.min(Math.max(options.timeoutMs ?? 15000, 1), 30000),
    maxRedirects: Math.min(Math.max(options.maxRedirects ?? 4, 0), 6),
    accept: options.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
  };
  let url = validatePublicUrl(input);
  const expiresAt = Date.now() + config.timeoutMs;
  for (let redirects = 0; redirects <= config.maxRedirects; redirects++) {
    if (Date.now() >= expiresAt) throw new SafeFetchError("This website took too long to respond. Try again.", "TIMEOUT");
    const target = await deadline(resolvePublicTarget(url), expiresAt - Date.now());
    const result = await requestTarget(target, { ...config, timeoutMs: Math.max(1, expiresAt - Date.now()) });
    if (![301, 302, 303, 307, 308].includes(result.status)) return result;
    if (!result.headers.location) throw new SafeFetchError("This website returned an invalid redirect.", "FETCH_FAILED");
    try {
      url = validatePublicUrl(new URL(result.headers.location, url));
    } catch (error) {
      if (error instanceof SafeFetchError) throw error;
      throw new SafeFetchError("This website returned an invalid redirect.", "FETCH_FAILED");
    }
  }
  throw new SafeFetchError("This website redirected too many times.", "TOO_MANY_REDIRECTS");
}

/** Inspect file signatures as well as response MIME, never serving HTML or SVG. */
export function rasterImageType(body: Uint8Array): string | null {
  const data = Buffer.from(body);
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 6 && /GIF8[79]a/.test(data.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (data.length >= 16 && data.subarray(4, 8).toString("ascii") === "ftyp") {
    const boxLength = Math.min(data.readUInt32BE(0), data.length, 128);
    for (let offset = 8; offset + 4 <= boxLength; offset += 4) {
      if (offset === 12) continue;
      if (["avif", "avis"].includes(data.subarray(offset, offset + 4).toString("ascii"))) return "image/avif";
    }
  }
  return null;
}
