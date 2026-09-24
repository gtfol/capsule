import assert from "node:assert/strict";
import test from "node:test";
import { checkRequestLimit, createDatabaseLimiter, createLocalLimiter, requestLimitKey, REQUEST_LIMITS } from "../src/lib/server/request-limit";
import { POST as importPost } from "../src/app/api/import/route";
import { POST as pricePost } from "../src/app/api/price/route";
import { GET as imageGet } from "../src/app/api/image/route";

test("limits use a keyed digest of the trusted IP and a separate bucket per operation", () => {
  const request = (headers: Record<string, string>) => new Request("https://capsule.test/api/import", { headers });
  const first = requestLimitKey(request({ "x-vercel-forwarded-for": "203.0.113.1" }), "import", "test-secret", true);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, requestLimitKey(request({ "x-vercel-forwarded-for": "203.0.113.1" }), "image", "test-secret", true));
  assert.notEqual(first, requestLimitKey(request({ "x-vercel-forwarded-for": "203.0.113.1" }), "import", "different-secret", true));
  assert.equal(requestLimitKey(request({ "x-forwarded-for": "203.0.113.1" }), "import", "s", true), requestLimitKey(request({ "x-forwarded-for": "203.0.113.2" }), "import", "s", true));
  assert.equal(requestLimitKey(request({ "x-vercel-forwarded-for": "2001:db8::1" }), "import", "s", true), requestLimitKey(request({ "x-vercel-forwarded-for": "2001:0db8:0:0:0:0:0:1" }), "import", "s", true));
  assert.equal(requestLimitKey(request({ "x-vercel-forwarded-for": "203.0.113.1" }), "import", "s", false), requestLimitKey(request({ "x-vercel-forwarded-for": "203.0.113.2" }), "import", "s", false));
});

test("local counters enforce an exact boundary, recover after expiry, and keep buckets separate", () => {
  let now = 1000;
  const limit = createLocalLimiter(() => now);
  const policy = { count: 2, seconds: 10 };
  assert.equal(limit("one", policy).allowed, true);
  assert.equal(limit("one", policy).allowed, true);
  assert.deepEqual(limit("one", policy), { allowed: false, retryAfter: 10 });
  assert.equal(limit("two", policy).allowed, true);
  now += 9001;
  assert.deepEqual(limit("one", policy), { allowed: false, retryAfter: 1 });
  now += 999;
  assert.equal(limit("one", policy).allowed, true);
});

test("database decisions and retry time are honored and malformed results fail", async () => {
  const limit = createDatabaseLimiter(async (_sql, values) => values ? { rows: [{ allowed: false, retry_after: 42 }] } : { rows: [] });
  assert.deepEqual(await limit("a".repeat(64), REQUEST_LIMITS.import), { allowed: false, retryAfter: 42 });
  await assert.rejects(createDatabaseLimiter(async () => ({ rows: [] }))("key", REQUEST_LIMITS.import));
});

test("public handlers reject excess requests before reading bodies or fetching images", async () => {
  const previous = { VERCEL: process.env.VERCEL, DATABASE_URL: process.env.DATABASE_URL };
  delete process.env.VERCEL; delete process.env.DATABASE_URL;
  try {
    for (const [scope, handler, method] of [["import", importPost, "POST"], ["price", pricePost, "POST"], ["image", imageGet, "GET"]] as const) {
      for (let index = 0; index < REQUEST_LIMITS[scope].count; index++) {
        const response = await handler(new Request(`https://capsule.test/api/${scope}`, { method }));
        assert.equal(response.status, 400);
      }
      const response = await handler(new Request(`https://capsule.test/api/${scope}`, { method }));
      assert.equal(response.status, 429);
      assert.ok(Number(response.headers.get("Retry-After")) > 0);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal((await response.json()).code, "RATE_LIMITED");
    }
    process.env.VERCEL = "1";
    const unavailable = await checkRequestLimit(new Request("https://capsule.test"), "import");
    assert.equal(unavailable?.status, 503);
    assert.equal(unavailable?.headers.get("Cache-Control"), "no-store");
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
