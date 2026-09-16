import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export const INTEGRATION_SCOPES = ["items:read", "wishlist:write", "wardrobe:write"] as const;
export type IntegrationScope = typeof INTEGRATION_SCOPES[number];
export class IntegrationError extends Error {
  constructor(message: string, public status = 400, public code = "INVALID_REQUEST") { super(message); }
}
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export type IntegrationToken = { id: string; user_id: string; scopes: IntegrationScope[] };
export function bearerHash(request: Request): string {
  const match = /^Bearer (capsule_[A-Za-z0-9_-]{43})$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new IntegrationError("A Capsule integration bearer token is required.", 401, "UNAUTHORIZED");
  return digest(match[1]);
}
export async function authenticateToken(db: Pool | PoolClient, hash: string, scopes: IntegrationScope[], lock = false): Promise<IntegrationToken> {
  const { rows } = await db.query<IntegrationToken>(`select id, user_id, scopes from public.capsule_integration_tokens
    where token_hash = $1 and revoked_at is null and expires_at > clock_timestamp() ${lock ? "for share" : ""}`, [hash]);
  const token = rows[0];
  if (!token) throw new IntegrationError("This integration token is invalid, expired, or revoked.", 401, "UNAUTHORIZED");
  if (scopes.some(scope => !token.scopes.includes(scope))) throw new IntegrationError("This token does not have the required permissions.", 403, "INSUFFICIENT_SCOPE");
  return token;
}
export async function createIntegrationToken(pool: Pool, userId: string, name: string, scopes: IntegrationScope[]) {
  const token = `capsule_${randomBytes(32).toString("base64url")}`;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`capsule:${userId}`]);
    const count = await client.query<{count: number}>("select count(*)::int as count from capsule_integration_tokens where user_id=$1 and revoked_at is null and expires_at > now()", [userId]);
    if (count.rows[0].count >= 10) throw new IntegrationError("Remove an unused token before creating another.", 409, "TOKEN_LIMIT");
    const result = await client.query(`insert into capsule_integration_tokens (id,user_id,name,token_hash,prefix,scopes,expires_at)
      values ($1,$2,$3,$4,$5,$6,now()+interval '90 days') returning id,name,prefix,scopes,created_at,expires_at,last_used_at`,
    [randomUUID(), userId, name, digest(token), token.slice(0, 16), scopes]);
    await client.query("commit");
    return { ...result.rows[0], token };
  } catch(error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
export function integrationFailure(error: unknown) {
  const known = error instanceof IntegrationError;
  return Response.json({ error: { code: known ? error.code : "UNAVAILABLE", message: known ? error.message : "The integration is temporarily unavailable. Retry with the same idempotency key." } }, {
    status: known ? error.status : 503, headers: { "Cache-Control": "no-store", ...(known && error.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}) },
  });
}
