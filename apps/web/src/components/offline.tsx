"use client";
import { useEffect } from "react";
export function OfflineSupport() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").then(async () => {
      const registration = await navigator.serviceWorker.ready;
      const urls = performance.getEntriesByType("resource").map((entry) => entry.name).filter((url) => url.startsWith(location.origin + "/_next/static/"));
      registration.active?.postMessage({ type: "CACHE_ASSETS", urls });
    }).catch(() => { /* IndexedDB remains available if service workers are blocked. */ });
  }, []);
  return null;
}
