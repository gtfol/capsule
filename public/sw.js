const CACHE = "capsule-shell-v1";
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(["/", "/icon.svg", "/manifest.webmanifest"]);
    const shell = await cache.match("/");
    const html = await shell.text();
    const assets = [...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
    await Promise.allSettled([...new Set(assets)].map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) => event.waitUntil((async () => { await Promise.all((await caches.keys()).filter((name) => name.startsWith("capsule-shell-") && name !== CACHE).map((name) => caches.delete(name))); await self.clients.claim(); })()));
self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_ASSETS" || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => { const cache = await caches.open(CACHE); await Promise.allSettled(event.data.urls.filter((value) => { try { const url = new URL(value); return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/"); } catch { return false; } }).map((url) => cache.add(url))); })());
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then(async (response) => { if (response.ok && url.pathname === "/") { const cache = await caches.open(CACHE); await cache.put("/", response.clone()); } return response; }).catch(async () => (await caches.match("/")) || Response.error()));
  } else if (url.pathname.startsWith("/_next/static/") || ["/icon.svg", "/manifest.webmanifest"].includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then(async (response) => { if (response.ok) { const cache = await caches.open(CACHE); await cache.put(event.request, response.clone()); } return response; })));
  }
});
