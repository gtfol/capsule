"use client";

import type { CaptureResult, PostHog, Properties } from "posthog-js";

// Product analytics for Capsule. Two rules shape everything here:
//
// 1. Wardrobe contents never leave the browser through this module. Events
//    carry counts, categories, and durations — never piece names, brands,
//    prices, product URLs, photos, API keys, or free text a person typed.
// 2. A share ID is the share link. Sending one to the analytics provider is
//    equivalent to sharing that capsule with them, so every ID is replaced by
//    a short non-reversible digest before any event or URL leaves the page.

export const ANALYTICS_HOSTS = {
  us: "https://us.i.posthog.com",
  eu: "https://eu.i.posthog.com",
} as const;

export type ShareKind = "wardrobe" | "wishlist" | "outfit" | "piece";
export type PieceCollection = "wardrobe" | "wishlist";
export type PieceSource = "manual" | "photo" | "url_import" | "extension" | "shared_copy";

export type AnalyticsEvent =
  | { name: "piece_added"; props: { collection: PieceCollection; source: PieceSource; has_photo: boolean } }
  | { name: "piece_removed"; props: { collection: PieceCollection } }
  | { name: "wishlist_piece_promoted"; props: Record<string, never> }
  | { name: "model_photo_set"; props: Record<string, never> }
  | { name: "render_key_saved"; props: { scope: "session" | "account" } }
  | { name: "outfit_render_started"; props: { piece_count: number; categories: string[] } }
  | { name: "outfit_render_completed"; props: { piece_count: number; duration_ms: number } }
  | { name: "outfit_render_failed"; props: { status: number | "timeout" | "offline" | "client" } }
  | { name: "outfit_removed"; props: Record<string, never> }
  | { name: "outfit_downloaded"; props: Record<string, never> }
  | { name: "share_link_created"; props: { kind: ShareKind; piece_count: number; expiry: string; share: string } }
  | { name: "share_link_revoked"; props: { kind: ShareKind; share: string } }
  | { name: "share_link_opened"; props: { kind: ShareKind; piece_count: number; share: string } }
  | { name: "shared_pieces_copied"; props: { kind: ShareKind; piece_count: number; share: string } }
  | { name: "account_signed_in"; props: Record<string, never> }
  | { name: "account_signed_out"; props: Record<string, never> };

type EventName = AnalyticsEvent["name"];
type PropsFor<N extends EventName> = Extract<AnalyticsEvent, { name: N }>["props"];

/**
 * A stable, non-reversible handle for one share link. Lets a link be counted
 * and compared across events without the ID itself reaching the provider.
 * FNV-1a over the ID: short, synchronous, and one-way for this purpose — the
 * ID space is far too large to enumerate from a 32-bit digest.
 */
export function shareHandle(id: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

const SHARE_PATH = /\/share\/[^/?#]+/g;

/** Replace share IDs in any URL or path with the route pattern. */
export function scrubShareUrl(value: string): string {
  return value.replace(SHARE_PATH, "/share/[id]");
}

const URL_PROPERTIES = new Set(["$current_url", "$pathname", "$referrer", "$referring_domain", "$initial_current_url", "$initial_pathname", "$initial_referrer", "$session_entry_url", "$session_entry_pathname", "$session_entry_referrer"]);

/** Strip share IDs out of the URL properties PostHog attaches automatically. */
export function sanitizeProperties(properties: Properties): Properties {
  const cleaned: Properties = { ...properties };
  for (const key of Object.keys(cleaned)) {
    const value = cleaned[key];
    if (typeof value === "string" && (URL_PROPERTIES.has(key) || key.endsWith("_url"))) {
      cleaned[key] = scrubShareUrl(value);
    }
  }
  return cleaned;
}

export type AnalyticsConfig = { key: string; host: string };

/** Analytics stays off unless a project key is configured for this deployment. */
export function readAnalyticsConfig(env: Record<string, string | undefined>): AnalyticsConfig | null {
  const key = env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  if (!key || !/^phc_[A-Za-z0-9]{16,}$/.test(key)) return null;
  const host = env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || ANALYTICS_HOSTS.us;
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(host)) return null;
  return { key, host };
}

/**
 * Init options, kept here rather than inline at the call site so the privacy
 * settings that matter — no autocapture, no replay, scrubbed URLs — are
 * asserted by tests rather than only reviewed by eye.
 */
export function analyticsInitOptions(host: string) {
  return {
    api_host: host,
    // Capsule holds personal photos. Nothing is captured that was not
    // instrumented deliberately: no DOM text, no inputs, no screen recording.
    autocapture: false,
    disable_session_recording: true,
    capture_pageview: false,
    capture_pageleave: true,
    capture_exceptions: false,
    persistence: "localStorage+cookie" as const,
    before_send: (event: CaptureResult | null): CaptureResult | null => {
      if (!event) return null;
      return { ...event, properties: sanitizeProperties(event.properties ?? {}) };
    },
  };
}

let client: PostHog | null = null;
let lastPath = "";

export function attachAnalytics(instance: PostHog | null) {
  client = instance;
}

/** Never let an analytics failure surface in a product flow. */
function safely(action: (instance: PostHog) => void) {
  if (!client) return;
  try {
    action(client);
  } catch { /* Analytics is best-effort and must not break the app. */ }
}

export function track<N extends EventName>(name: N, props: PropsFor<N> = {} as PropsFor<N>) {
  safely((instance) => instance.capture(name, props));
}

export function trackPageview(url: string) {
  const path = new URL(url, "https://capsule.invalid").pathname;
  // nuqs drives Capsule's views through query parameters. Counting those as
  // visits would inflate pageviews, so only a real path change is a pageview.
  if (path === lastPath) return;
  lastPath = path;
  safely((instance) => instance.capture("$pageview", { $current_url: scrubShareUrl(url) }));
}

/** Link this browser to an account so one person's activity joins up across devices. */
export function identifyAccount(userId: string) {
  safely((instance) => {
    if (instance.get_distinct_id() === userId) return;
    // The account ID only — never email or display name.
    instance.identify(userId);
  });
}

export function resetIdentity() {
  safely((instance) => instance.reset());
}
