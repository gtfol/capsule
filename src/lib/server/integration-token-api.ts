import type { Pool } from "pg";
import { z } from "zod";
import { readLimitedJson } from "./render";
import { createIntegrationToken, INTEGRATION_SCOPES, INTEGRATION_EXPIRIES, IntegrationError, integrationFailure } from "./integration-tokens";

const creation = z.object({expectedUserId:z.string().min(1).max(256),name:z.string().trim().min(1).max(80),scopes:z.array(z.enum(INTEGRATION_SCOPES)).min(1).max(3).refine(values=>new Set(values).size===values.length),expires:z.enum(INTEGRATION_EXPIRIES).default("90d")}).strict();
const removal = z.object({expectedUserId:z.string().min(1).max(256),id:z.uuid()}).strict();
export function createIntegrationTokenHandlers(pool: Pool, sessionUser: (request: Request) => Promise<string | null>) {
  return async (request: Request) => {
    try {
      const origin = request.headers.get("origin");
      if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin) || (request.method !== "GET" && !origin)) throw new IntegrationError("Manage integrations from Capsule.",403);
      const userId = await sessionUser(request);
      if (!userId) throw new IntegrationError("Sign in through Sync to manage integrations.",401);
      if (request.method === "GET") {
        if (new URL(request.url).searchParams.get("expectedUserId") !== userId) throw new IntegrationError("Your signed-in account changed. Reopen Settings.",409);
        const {rows} = await pool.query("select id,name,prefix,scopes,created_at,expires_at,last_used_at from capsule_integration_tokens where user_id=$1 and revoked_at is null order by created_at desc",[userId]);
        return Response.json({userId,tokens:rows},{headers:{"Cache-Control":"no-store"}});
      }
      if (!request.headers.get("content-type")?.includes("application/json")) throw new IntegrationError("Send a JSON request.",415);
      let body: z.infer<typeof creation> | z.infer<typeof removal>;
      try { const raw = await readLimitedJson(request.body,2048); body = request.method === "POST" ? creation.parse(raw) : removal.parse(raw); }
      catch { throw new IntegrationError("Check the integration name and permissions."); }
      if (body.expectedUserId !== userId) throw new IntegrationError("Your signed-in account changed. Reopen Settings.",409);
      if ("name" in body) return Response.json({userId,...await createIntegrationToken(pool,userId,body.name,body.scopes,body.expires)}, {headers:{"Cache-Control":"no-store"}});
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`capsule:${userId}`]);
        await client.query("update capsule_integration_tokens set revoked_at=coalesce(revoked_at,now()) where user_id=$1 and id=$2",[userId,body.id]);
        await client.query("commit");
      } catch(error) { await client.query("rollback"); throw error; }
      finally { client.release(); }
      return Response.json({userId,revoked:true},{headers:{"Cache-Control":"no-store"}});
    } catch(error) { return integrationFailure(error); }
  };
}
