import { getAuth } from "./auth";
import { getPool } from "./db";
import { readLimitedJson } from "./render";
import { hashShareToken, validateShareId } from "./shares";

type Link = { id: string; hash: string };
type Dependencies = { userId: (request: Request) => Promise<string | null>; remove: (userId: string, links: Link[]) => Promise<void> };
export async function removeAccount(userId: string, links: Link[]) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`capsule:${userId}`]);
    for (const link of links) {
      // A revoked placeholder also blocks a late response from an in-flight share creation.
      await client.query(`insert into public.capsule_shares (id, token_hash, snapshot, expires_at, revoked_at, updated_at)
        values ($1, $2, null, null, now(), now())
        on conflict (id) do update set snapshot = null, revoked_at = now(), updated_at = now()
        where capsule_shares.token_hash = excluded.token_hash`, [link.id, link.hash]);
    }
    await client.query('delete from public."verification" where value = $1 or identifier = (select email from public."user" where id = $1)', [userId]);
    // Foreign keys cascade to sessions, OAuth accounts, synced records, and encrypted keys.
    await client.query('delete from public."user" where id = $1', [userId]);
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
const dependencies: Dependencies = {
  userId: async (request) => (await getAuth()?.api.getSession({ headers: request.headers, query: { disableCookieCache: true } }))?.user.id ?? null,
  remove: removeAccount,
};
export function createAccountDeleteHandler(deps: Dependencies = dependencies) {
  return async (request: Request) => {
    const reply = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return reply("Request this action from Capsule.", 403);
    if (!request.headers.get("content-type")?.includes("application/json")) return reply("A JSON request is required.", 415);
    try {
      const userId = await deps.userId(request);
      if (!userId) return reply("Sign in again before deleting your account.", 401);
      let body: { expectedUserId?: unknown; confirmation?: unknown; links?: unknown };
      try {
        body = await readLimitedJson(request.body, 200_000) as typeof body;
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
      } catch { return reply("The deletion request is invalid or too large.", 400); }
      if (body.expectedUserId !== userId) return reply("Your signed-in account changed. Reopen Settings.", 409);
      if (body.confirmation !== "DELETE" || !Array.isArray(body.links) || body.links.length > 1000) return reply("Confirm account deletion to continue.", 400);
      let links: Link[];
      try { links = body.links.map((link) => ({ id: validateShareId(link?.id), hash: hashShareToken(link?.token) })); } catch { return reply("Your share links could not be verified.", 400); }
      await deps.remove(userId, links);
      return Response.json({ deleted: true, userId }, { headers: { "Cache-Control": "no-store" } });
    } catch { return reply("Your account deletion could not be confirmed. Try again.", 503); }
  };
}
