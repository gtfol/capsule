import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getAuth } from "@/lib/server/auth";
import { getPool } from "@/lib/server/db";
import { readSyncBody, validateSyncRequest } from "@/lib/server/sync-validation";
import type { Collection, SyncChange, SyncOutcome, SyncRow, WardrobeRecord } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";
type DatabaseRow = { collection: Collection; record: WardrobeRecord; revision: string };
const rowValue = (row: DatabaseRow): SyncRow => ({ collection: row.collection, record: row.record, revision: Number(row.revision) });
const privateHeaders = { "Cache-Control": "no-store" };

async function push(client: PoolClient, userId: string, change: SyncChange): Promise<SyncOutcome> {
  const { collection, record, baseRevision } = change;
  const values = [userId, collection, record.id];
  const current = await client.query<DatabaseRow>("select collection, record, revision from capsule_records where user_id = $1 and collection = $2 and id = $3", values);
  const existing = current.rows[0];
  if (existing) {
    // Exact retry after a lost response is idempotent even with an old base.
    const same = await client.query<{ same: boolean }>("select record = $4::jsonb as same from capsule_records where user_id = $1 and collection = $2 and id = $3", [...values, JSON.stringify(record)]);
    if (same.rows[0]?.same) return { id: record.id, collection, status: "ok", revision: Number(existing.revision) };
    if (Number(existing.revision) !== baseRevision) return { id: record.id, collection, status: "conflict", server: rowValue(existing) };
    const result = await client.query<{ revision: string }>(
      "update capsule_records set record = $4::jsonb, revision = nextval('capsule_sync_revision') where user_id = $1 and collection = $2 and id = $3 and revision = $5 returning revision",
      [...values, JSON.stringify(record), baseRevision],
    );
    if (!result.rows[0]) throw new Error("Concurrent sync write.");
    return { id: record.id, collection, status: "ok", revision: Number(result.rows[0].revision) };
  }
  const result = await client.query<{ revision: string }>(
    "insert into capsule_records (user_id, collection, id, record) values ($1, $2, $3, $4::jsonb) returning revision",
    [...values, JSON.stringify(record)],
  );
  return { id: record.id, collection, status: "ok", revision: Number(result.rows[0].revision) };
}

export async function POST(request: Request) {
  const auth = getAuth();
  if (!auth) return NextResponse.json({ error: "Sync is not configured on this deployment." }, { status: 503, headers: privateHeaders });
  const origin = request.headers.get("origin");
  const allowedOrigin = process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL).origin : new URL(request.url).origin;
  if (origin && origin !== allowedOrigin) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  if (!request.headers.get("content-type")?.includes("application/json")) return NextResponse.json({ error: "A JSON request is required." }, { status: 415 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Sign in to sync." }, { status: 401, headers: privateHeaders });
  let body: ReturnType<typeof validateSyncRequest>;
  try { body = validateSyncRequest(await readSyncBody(request)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid sync request." }, { status: 400, headers: privateHeaders }); }
  const userId = session.user.id;
  if (body.expectedUserId !== userId) return NextResponse.json({ error: "The signed-in account changed." }, { status: 409, headers: privateHeaders });
  const client = await getPool().connect();
  try {
    await client.query("begin");
    // Serialize this account's requests, so sequence cursors never pass a
    // same-account change that has allocated its revision but not committed.
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`capsule:${userId}`]);
    const results: SyncOutcome[] = [];
    let responseBytes = 500;
    for (const change of body.changes) {
      const result = await push(client, userId, change);
      const resultBytes = Buffer.byteLength(JSON.stringify(result));
      // Conflict records can be much larger than the submitted changes.
      // Leave unacknowledged changes queued for the next bounded response.
      if (results.length && responseBytes + resultBytes > 3_500_000) break;
      responseBytes += resultBytes;
      results.push(result);
    }
    const selected = await client.query<DatabaseRow>(
      "select collection, record, revision from capsule_records where user_id = $1 and revision > $2 order by revision asc limit 31",
      [userId, body.cursor],
    );
    const rows: SyncRow[] = [];
    for (const source of selected.rows) {
      const row = rowValue(source);
      const bytes = Buffer.byteLength(JSON.stringify(row));
      if (rows.length >= 30 || responseBytes + bytes > 3_800_000) break;
      rows.push(row); responseBytes += bytes;
    }
    await client.query("commit");
    return NextResponse.json({ userId, results, rows, cursor: rows.at(-1)?.revision ?? body.cursor, hasMore: rows.length < selected.rows.length }, { headers: privateHeaders });
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    console.error("Capsule sync failed", error instanceof Error ? error.message : "Unknown database error");
    return NextResponse.json({ error: "Sync could not finish. Your changes are saved in this browser." }, { status: 500, headers: privateHeaders });
  } finally { client.release(); }
}
