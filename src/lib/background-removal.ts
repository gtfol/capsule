"use client";

import { MAX_PHOTO_BYTES } from "./images";
import type { BackgroundProgress, BackgroundResponse } from "./background-removal-types";
export type { BackgroundProgress } from "./background-removal-types";

let worker: Worker | null = null;
let active = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const aborted = () => new DOMException("Background removal cancelled.", "AbortError");

function releaseWorker() {
  worker?.terminate();
  worker = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function asDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The cutout could not be opened. Try again."));
    reader.readAsDataURL(blob);
  });
}

// The worker and model are loaded only after an explicit Remove background action.
export async function removeBackground(
  source: Blob | string,
  onProgress: (progress: BackgroundProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw aborted();
  if (active) throw new Error("Wait for the current photo to finish, or cancel it.");
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
    throw new Error("Background removal is unavailable in this browser. You can keep the original photo.");
  }
  active = true;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  try {
    const response = typeof source === "string" ? await fetch(source, { signal }) : null;
    if (response && !response.ok) throw new Error("This photo could not be opened. Try another photo.");
    const image = response ? await response.blob() : source as Blob;
    if (signal?.aborted) throw aborted();
    if (!image.size || image.size > MAX_PHOTO_BYTES || !/^image\/(jpeg|png|webp|avif)$/.test(image.type)) {
      throw new Error("Choose a JPG, PNG, WebP, or AVIF photo smaller than 20 MB.");
    }
    worker ??= new Worker(new URL("./background-removal.worker.ts", import.meta.url), { type: "module" });
    const currentWorker = worker;
    const id = crypto.randomUUID();
    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancel);
        currentWorker.removeEventListener("message", receive);
        currentWorker.removeEventListener("error", failed);
      };
      const finish = (error?: Error, result?: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) { releaseWorker(); reject(error); }
        else resolve(result!);
      };
      const cancel = () => finish(aborted());
      const failed = () => finish(new Error("Background removal could not run on this device. You can keep the original photo."));
      const receive = async (event: MessageEvent<BackgroundResponse>) => {
        const message = event.data;
        if (message.id !== id || settled) return;
        if (message.type === "progress") {
          try { onProgress(message.value); }
          catch { failed(); }
        }
        if (message.type === "error") finish(new Error(message.message));
        if (message.type === "complete") {
          try {
            const result = await asDataURL(message.image);
            if (signal?.aborted) cancel();
            else finish(undefined, result);
          } catch { finish(new Error("The cutout could not be saved. Try again.")); }
        }
      };
      const timeout = setTimeout(() => finish(new Error("Background removal took too long. Try a smaller photo, or keep the original.")), 300_000);
      currentWorker.addEventListener("message", receive);
      currentWorker.addEventListener("error", failed);
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        onProgress({ stage: "download" });
        if (signal?.aborted) cancel();
        else currentWorker.postMessage({ id, image });
      } catch { failed(); }
    });
  } finally {
    active = false;
    // Free the model's GPU/CPU memory after the user finishes editing a pair.
    if (worker) idleTimer = setTimeout(releaseWorker, 60_000);
  }
}
