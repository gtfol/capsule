import assert from "node:assert/strict";
import test from "node:test";
import { ANALYTICS_HOSTS, analyticsInitOptions, readAnalyticsConfig, sanitizeProperties, scrubShareUrl, shareHandle } from "../src/lib/analytics";

const key = `phc_${"a1B2c3D4e5F6g7H8".repeat(2)}`;

test("analytics stays off unless a well-formed project key is configured", () => {
  assert.equal(readAnalyticsConfig({}), null);
  assert.equal(readAnalyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: "" }), null);
  assert.equal(readAnalyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: "   " }), null);
  assert.equal(readAnalyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: "not-a-posthog-key" }), null);
  assert.equal(readAnalyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: "phc_short" }), null);
  assert.deepEqual(readAnalyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: ` ${key} ` }), { key, host: ANALYTICS_HOSTS.us });
  assert.deepEqual(readAnalyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: key, NEXT_PUBLIC_POSTHOG_HOST: ANALYTICS_HOSTS.eu }), { key, host: ANALYTICS_HOSTS.eu });
  // A host that is not a plain https origin is a misconfiguration, not a
  // reason to send this deployment's events somewhere unexpected.
  for (const host of ["http://us.i.posthog.com", "javascript:alert(1)", "https://evil.example.com/collect?x=1", "us.i.posthog.com"]) {
    assert.equal(readAnalyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: key, NEXT_PUBLIC_POSTHOG_HOST: host }), null, host);
  }
});

test("share IDs never reach the provider through a URL", () => {
  assert.equal(scrubShareUrl("https://capsule.gtfol.dev/share/AbCdEfGhIjKlMnOpQrStUv"), "https://capsule.gtfol.dev/share/[id]");
  assert.equal(scrubShareUrl("/share/AbCdEfGhIjKlMnOpQrStUv?addTo=wardrobe"), "/share/[id]?addTo=wardrobe");
  assert.equal(scrubShareUrl("https://capsule.gtfol.dev/"), "https://capsule.gtfol.dev/");
  const cleaned = sanitizeProperties({
    $current_url: "https://capsule.gtfol.dev/share/AbCdEfGhIjKlMnOpQrStUv",
    $pathname: "/share/AbCdEfGhIjKlMnOpQrStUv",
    $referrer: "https://capsule.gtfol.dev/share/AbCdEfGhIjKlMnOpQrStUv",
    $session_entry_url: "https://capsule.gtfol.dev/share/AbCdEfGhIjKlMnOpQrStUv",
    piece_count: 3,
  });
  assert.equal(JSON.stringify(cleaned).includes("AbCdEfGhIjKlMnOpQrStUv"), false);
  assert.equal(cleaned.$pathname, "/share/[id]");
  assert.equal(cleaned.piece_count, 3);
});

test("a share handle is stable, opaque, and distinct per link", () => {
  const id = "AbCdEfGhIjKlMnOpQrStUv";
  const handle = shareHandle(id);
  assert.equal(handle, shareHandle(id));
  assert.notEqual(handle, shareHandle("AbCdEfGhIjKlMnOpQrStUw"));
  assert.equal(handle.includes(id), false);
  assert.match(handle, /^[a-z0-9]{7}$/);
  // Distinct links must not collide in practice.
  const handles = new Set(Array.from({ length: 5_000 }, (_, index) => shareHandle(`share-${index}-AbCdEfGhIjKl`)));
  assert.ok(handles.size > 4_990, `expected near-unique handles, got ${handles.size}`);
});

test("init options disable automatic capture and scrub URLs before anything is sent", () => {
  const options = analyticsInitOptions(ANALYTICS_HOSTS.us);
  assert.equal(options.api_host, ANALYTICS_HOSTS.us);
  assert.equal(options.autocapture, false);
  assert.equal(options.disable_session_recording, true);
  assert.equal(options.capture_pageview, false, "pageviews are captured manually, once per real path change");

  // The hook is the only thing standing between an auto-attached referrer and
  // the provider, so assert it rather than trusting the call site.
  const sent = options.before_send({
    uuid: "0199a0f0-0000-7000-8000-000000000000",
    event: "$pageview",
    properties: {
      $current_url: "https://capsule.gtfol.dev/share/AbCdEfGhIjKlMnOpQrStUv",
      $referrer: "https://capsule.gtfol.dev/share/AbCdEfGhIjKlMnOpQrStUv",
      piece_count: 2,
    },
  });
  assert.equal(JSON.stringify(sent).includes("AbCdEfGhIjKlMnOpQrStUv"), false);
  assert.equal(sent?.properties.$current_url, "https://capsule.gtfol.dev/share/[id]");
  assert.equal(sent?.properties.piece_count, 2);
  assert.equal(sent?.event, "$pageview", "the hook rewrites properties without altering the event");
  assert.equal(options.before_send(null), null);
});
