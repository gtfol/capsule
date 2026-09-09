import assert from "node:assert/strict";
import test from "node:test";
import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { PassThrough } from "node:stream";
import { gzipSync } from "node:zlib";
import { isPublicAddress, rasterImageType, resolvePublicTarget, safeFetch, SafeFetchError, validatePublicUrl } from "../src/lib/server/safe-fetch";

test("rejects IPv4 local, reserved, metadata, carrier NAT, and documentation networks", () => {
  for (const address of ["0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "100.127.255.255", "192.0.0.1", "192.0.2.3", "192.88.99.1", "198.18.0.1", "198.19.1.2", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["1.1.1.1", "8.8.8.8", "93.184.215.14", "172.32.0.1", "100.128.0.1"]) assert.equal(isPublicAddress(address), true, address);
});

test("rejects IPv6 local, mapped, translation, tunnel, multicast, and documentation networks", () => {
  for (const address of ["::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:8.8.8.8", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "64:ff9b::a00:1", "2001::1", "2001:db8::1", "2002:7f00:1::", "3fff::1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001::200e"]) assert.equal(isPublicAddress(address), true, address);
});

test("normalizes alternate IP representations before blocking them", () => {
  for (const url of ["http://127.1/image", "http://2130706433/image", "http://0x7f000001/image", "http://0177.0.0.1/image", "http://[::ffff:7f00:1]/image", "http://localhost./image", "http://metadata.google.internal/image", "http://machine.local/image"]) {
    assert.throws(() => validatePublicUrl(url), (error: unknown) => error instanceof SafeFetchError && error.code === "BLOCKED_URL", url);
  }
});

test("refuses custom ports, credentials, unsupported schemes, and malformed URLs", () => {
  for (const url of ["http://example.com:3000/", "https://user:pass@example.com/", "file:///etc/passwd", "ftp://example.com/file", "not a url"]) assert.throws(() => validatePublicUrl(url), SafeFetchError);
  assert.equal(validatePublicUrl("https://example.com:443/product#image").href, "https://example.com/product");
});

test("rejects mixed public and private DNS results", async () => {
  await assert.rejects(resolvePublicTarget("https://shop.example.com/", async () => [
    { address: "1.1.1.1", family: 4 }, { address: "10.0.0.1", family: 4 },
  ]), (error: unknown) => error instanceof SafeFetchError && error.code === "BLOCKED_URL");
});

test("returns the validated address to pin directly, preserving hostname for TLS and Host", async () => {
  let lookups = 0;
  const target = await resolvePublicTarget("https://shop.example.com/product?q=1", async (hostname) => {
    lookups++;
    assert.equal(hostname, "shop.example.com");
    return [{ address: "2606:4700:4700::1111", family: 6 }, { address: "1.1.1.1", family: 4 }];
  });
  assert.equal(lookups, 1);
  assert.equal(target.address, "1.1.1.1");
  assert.equal(target.hostname, "shop.example.com");
  assert.equal(target.family, 4);
  assert.equal(target.url.pathname + target.url.search, "/product?q=1");
});

test("direct IP links never make an extra DNS lookup", async () => {
  const target = await resolvePublicTarget("https://1.1.1.1/", async () => { throw new Error("Must not resolve again"); });
  assert.equal(target.address, "1.1.1.1");
});

test("rejects unsafe fetches before opening a socket", async () => {
  await assert.rejects(safeFetch("http://169.254.169.254/latest/meta-data/"), (error: unknown) => error instanceof SafeFetchError && error.code === "BLOCKED_URL");
});

test("detects supported image signatures and rejects active content", () => {
  assert.equal(rasterImageType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "image/png");
  assert.equal(rasterImageType(Buffer.from([255, 216, 255, 224])), "image/jpeg");
  assert.equal(rasterImageType(Buffer.from("GIF89a")), "image/gif");
  assert.equal(rasterImageType(Buffer.from("RIFF1234WEBP")), "image/webp");
  const avif = Buffer.alloc(24);
  avif.writeUInt32BE(24, 0);
  avif.write("ftypavif", 4);
  assert.equal(rasterImageType(avif), "image/avif");
  for (const body of ["<svg><script>alert(1)</script></svg>", "<!doctype html><html>Blocked</html>", "not an image"]) assert.equal(rasterImageType(Buffer.from(body)), null);
});

function simulatedRequest(
  reply: { status?: number; headers?: Record<string, string>; body?: Buffer },
  inspect: (options: RequestOptions & { servername?: string }) => void = () => {},
): typeof https.request {
  return ((options: RequestOptions) => {
    inspect(options);
    const request = new EventEmitter() as ClientRequest;
    request.destroy = (() => request) as typeof request.destroy;
    request.end = (() => {
      queueMicrotask(() => {
        const response = new PassThrough() as unknown as IncomingMessage;
        response.statusCode = reply.status ?? 200;
        response.headers = reply.headers ?? { "content-type": "text/html" };
        request.emit("response", response);
        if (!response.destroyed) (response as unknown as PassThrough).end(reply.body ?? Buffer.from("product"));
      });
      return request;
    }) as typeof request.end;
    return request;
  }) as typeof https.request;
}

test("the request connects to the resolved address, keeping the original TLS and Host identity", async (context) => {
  let resolutions = 0;
  context.mock.method(dns, "lookup", async () => {
    resolutions++;
    return [{ address: resolutions === 1 ? "1.1.1.1" : "127.0.0.1", family: 4 }];
  });
  context.mock.method(https, "request", simulatedRequest({}, (options) => {
    assert.equal(options.hostname, "1.1.1.1");
    assert.equal(options.servername, "shop.example.com");
    assert.equal((options.headers as Record<string, string>).Host, "shop.example.com");
    assert.equal(options.agent, false);
  }));
  assert.equal((await safeFetch("https://shop.example.com/product")).body.toString(), "product");
  assert.equal(resolutions, 1, "The socket must not resolve DNS again");
});

test("redirects to private addresses are rejected before a second request", async (context) => {
  context.mock.method(dns, "lookup", async () => [{ address: "1.1.1.1", family: 4 }]);
  let requests = 0;
  context.mock.method(https, "request", simulatedRequest({ status: 302, headers: { location: "http://169.254.169.254/metadata" } }, () => { requests++; }));
  await assert.rejects(safeFetch("https://shop.example.com/product"), (error: unknown) => error instanceof SafeFetchError && error.code === "BLOCKED_URL");
  assert.equal(requests, 1);
});

test("each redirect checks DNS again and rejects a rebound destination", async (context) => {
  let resolutions = 0;
  context.mock.method(dns, "lookup", async () => [{ address: ++resolutions === 1 ? "1.1.1.1" : "10.1.1.1", family: 4 }]);
  let requests = 0;
  context.mock.method(https, "request", simulatedRequest({ status: 302, headers: { location: "/new-product" } }, () => { requests++; }));
  await assert.rejects(safeFetch("https://shop.example.com/product"), (error: unknown) => error instanceof SafeFetchError && error.code === "BLOCKED_URL");
  assert.equal(resolutions, 2);
  assert.equal(requests, 1);
});

test("compressed responses are bounded by their decompressed size", async (context) => {
  context.mock.method(dns, "lookup", async () => [{ address: "1.1.1.1", family: 4 }]);
  context.mock.method(https, "request", simulatedRequest({ headers: { "content-encoding": "gzip" }, body: gzipSync(Buffer.alloc(2048, "x")) }));
  await assert.rejects(safeFetch("https://shop.example.com/product", { maxBytes: 128 }), (error: unknown) => error instanceof SafeFetchError && error.code === "TOO_LARGE");
});

test("the total timeout includes DNS resolution", async (context) => {
  context.mock.method(dns, "lookup", () => new Promise((resolve) => setTimeout(() => resolve([{ address: "1.1.1.1", family: 4 }]), 40)));
  await assert.rejects(safeFetch("https://shop.example.com/product", { timeoutMs: 5 }), (error: unknown) => error instanceof SafeFetchError && error.code === "TIMEOUT");
});
