import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { readLimitedJson } from "./render";
import { authenticateToken, bearerHash, digest, IntegrationError, integrationFailure, issueIntegrationToken } from "./integration-tokens";

export const SCAN_CALLBACK = "dev.gtfol.capsulescan://auth/callback";
const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const scanAuthorization = z.object({code_challenge:opaque,state:opaque,access:z.enum(["capture","wardrobe"]).default("capture")}).strict();
const authorizeBody = scanAuthorization.extend({expectedUserId:z.string().min(1).max(256)}).strict();
const exchangeBody = z.object({code:opaque,code_verifier:z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/)}).strict();
export type ScanBrowserSession = {user:{id:string;name:string};session:{id:string}};
const invalidCode = () => new IntegrationError("sign-in expired. return to the capsule app and try again.",400,"INVALID_CODE");
const headers = {"Cache-Control":"private, no-store", "Referrer-Policy":"no-referrer"};

export function createScanAuth(pool: Pool, sessionFor: (request: Request) => Promise<ScanBrowserSession | null>) {
  async function body(request: Request) {
    if (!request.headers.get("content-type")?.includes("application/json")) throw new IntegrationError("send a json request.",415);
    try { return await readLimitedJson(request.body,2048); }
    catch { throw new IntegrationError("invalid sign-in request."); }
  }
  return {
    async authorize(request: Request) {
      try {
        if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new IntegrationError("sign in from capsule.",403);
        const parsed = authorizeBody.safeParse(await body(request));
        if (!parsed.success) throw new IntegrationError("invalid sign-in request.");
        const session = await sessionFor(request);
        if (!session) throw new IntegrationError("sign in to capsule first.",401);
        if (session.user.id !== parsed.data.expectedUserId) throw new IntegrationError("your account changed. reload and try again.",409);
        const code = randomBytes(32).toString("base64url");
        // Reuse Better Auth's existing expiring verification store with a private
        // namespace. Only the code hash is stored; no bearer token is in a URL.
        await pool.query(`delete from "verification" where identifier like 'capsule-scan:%' and "expiresAt" <= now()`);
        await pool.query(`insert into "verification" (id,identifier,value,"expiresAt","createdAt","updatedAt") values ($1,$2,$3,now()+interval '2 minutes',now(),now())`,
          [randomUUID(),`capsule-scan:${digest(code)}`,JSON.stringify({userId:session.user.id,sessionId:session.session.id,challenge:parsed.data.code_challenge,access:parsed.data.access})]);
        const callback = new URL(SCAN_CALLBACK);
        callback.searchParams.set("code",code); callback.searchParams.set("state",parsed.data.state);
        return Response.json({callbackURL:callback.toString()},{headers});
      } catch(error) { return integrationFailure(error); }
    },
    async exchange(request: Request) {
      try {
        // The exchange belongs to the native client, never a cross-origin webpage.
        if (request.headers.has("origin") || request.headers.get("sec-fetch-site") === "cross-site") throw new IntegrationError("return to the capsule app to finish signing in.",403);
        const parsed = exchangeBody.safeParse(await body(request));
        if (!parsed.success) throw invalidCode();
        const challenge = createHash("sha256").update(parsed.data.code_verifier).digest("base64url");
        const client = await pool.connect();
        try {
          await client.query("begin");
          const {rows} = await client.query<{id:string;value:string}>(`select id,value from "verification" where identifier=$1 and "expiresAt">now() for update`,[`capsule-scan:${digest(parsed.data.code)}`]);
          if (rows.length !== 1) throw invalidCode();
          const grant = z.object({userId:z.string().min(1),sessionId:z.string().min(1),challenge:opaque,access:z.enum(["capture","wardrobe"]).default("capture")}).parse(JSON.parse(rows[0].value));
          if (!timingSafeEqual(Buffer.from(grant.challenge),Buffer.from(challenge))) throw invalidCode();
          const user = (await client.query<{id:string;name:string}>(`select u.id,u.name from "user" u join "session" s on s."userId"=u.id where u.id=$1 and s.id=$2 and s."expiresAt">now()`,[grant.userId,grant.sessionId])).rows[0];
          if (!user) throw invalidCode();
          const scopes = grant.access === "wardrobe" ? ["items:read", "wardrobe:write", "wardrobe:delete"] as const : ["wardrobe:write"] as const;
          const token = await issueIntegrationToken(client,user.id,"capsule",[...scopes],"1y");
          await client.query(`delete from "verification" where id=$1`,[rows[0].id]);
          await client.query("commit");
          return Response.json({token:token.token,user,scopes,expiresAt:token.expires_at},{headers});
        } catch(error) { await client.query("rollback"); throw error; }
        finally { client.release(); }
      } catch(error) { return integrationFailure(error); }
    },
    async session(request: Request) {
      try {
        const hash = bearerHash(request);
        const token = await authenticateToken(pool,hash,["wardrobe:write"]);
        if (request.method === "DELETE") {
          await pool.query("update capsule_integration_tokens set revoked_at=coalesce(revoked_at,now()) where id=$1 and user_id=$2",[token.id,token.user_id]);
          return Response.json({signedOut:true},{headers});
        }
        const user = (await pool.query<{id:string;name:string}>(`select id,name from "user" where id=$1`,[token.user_id])).rows[0];
        if (!user) throw new IntegrationError("sign in again.",401);
        return Response.json({user,scopes:token.scopes},{headers});
      } catch(error) { return integrationFailure(error); }
    },
  };
}
