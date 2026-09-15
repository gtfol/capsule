import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createDatabaseLimiter } from "../src/lib/server/request-limit";

// Point only at a disposable database with the request-limit migration applied.
test("Postgres counters remain atomic across instances and reset after their window", { skip: !process.env.TEST_RATE_LIMIT_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_RATE_LIMIT_DATABASE_URL, max: 10 });
  const key = randomBytes(32).toString("hex");
  const other = randomBytes(32).toString("hex");
  try {
    const query = (sql: string, values?: unknown[]) => pool.query(sql, values);
    const instances = Array.from({ length: 4 }, () => createDatabaseLimiter(query));
    const policy = { count: 7, seconds: 60 };
    const results = await Promise.all(Array.from({ length: 40 }, (_, index) => instances[index % 4](key, policy)));
    assert.equal(results.filter((result) => result.allowed).length, 7);
    assert.ok(results.every((result) => result.retryAfter >= 1 && result.retryAfter <= 60));
    assert.equal((await pool.query("select requests from capsule_request_limits where key = $1", [key])).rows[0].requests, 8);
    assert.equal((await instances[0](other, policy)).allowed, true);
    await pool.query("update capsule_request_limits set window_start = now() - interval '61 seconds' where key = $1", [key]);
    assert.equal((await instances[1](key, policy)).allowed, true);
    const security = await pool.query("select relrowsecurity from pg_class where oid = 'public.capsule_request_limits'::regclass");
    assert.equal(security.rows[0].relrowsecurity, true);
  } finally {
    await pool.query("delete from capsule_request_limits where key = any($1)", [[key, other]]);
    await pool.end();
  }
});
