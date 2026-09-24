import type { Pool } from "pg";
import sharp from "sharp";
import { z } from "zod";
import { getAuth } from "./auth";
import { authenticateToken, bearerHash, digest, IntegrationError, integrationFailure, type IntegrationScope } from "./integration-tokens";
import { parseRaster, readLimitedJson } from "./render";
import { createDatabaseLimiter } from "./request-limit";

const schema = z.object({ expectedRevision: z.number().int().nonnegative().safe(), imageData: z.string().max(2_100_000).nullable() }).strict();
const reply = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "private, no-store" } });
type SessionUser = (request: Request) => Promise<string | null>;
const sessionUser: SessionUser = async request => (await getAuth()?.api.getSession({ headers: request.headers, query: { disableCookieCache: true } }))?.user.id ?? null;
export async function prepareModelPhoto(value: string | null): Promise<string | null> {
  if (value === null) return null;
  try {
    const raster = parseRaster(value, 1_500_000);
    const bytes = await sharp(raster.bytes, { limitInputPixels: 25_000_000 }).rotate()
      .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).jpeg({ quality: 82 }).toBuffer();
    if (bytes.length > 1_500_000) throw new Error();
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } catch { throw new IntegrationError("Choose a smaller photo in JPEG, PNG, or WebP format."); }
}
export function modelPhotoFailure(error: unknown) {
  return integrationFailure(error instanceof IntegrationError ? error : new IntegrationError("Your model photo could not sync. Try again.", 503, "UNAVAILABLE"));
}
export function createModelPhotoHandler(pool: Pool, native: boolean, userFor: SessionUser = sessionUser) {
  const limit = createDatabaseLimiter((sql, values) => pool.query(sql, values));
  return async (request: Request): Promise<Response> => {
    try {
      const writing = request.method === "PUT";
      if (!writing && request.method !== "GET") throw new IntegrationError("Method not allowed.", 405);
      const scopes: IntegrationScope[] = [writing ? "outfits:write" : "outfits:read"];
      let hash: string | undefined, userId: string;
      if (native) {
        hash = bearerHash(request);
        userId = (await authenticateToken(pool, hash, scopes)).user_id;
      } else {
        const origin = request.headers.get("origin");
        if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin) || (writing && !origin)) throw new IntegrationError("Use Capsule to update your model photo.", 403);
        const user = await userFor(request);
        if (!user) throw new IntegrationError("Sign in to sync your model photo.", 401);
        if (request.headers.get("x-capsule-user") !== user) throw new IntegrationError("Your account changed. Sign in again.", 409, "ACCOUNT_CHANGED");
        userId = user;
      }
      const rate = await limit(digest(`capsule:model-photo:${userId}`), { count: 90, seconds: 60 });
      if (!rate.allowed) throw new IntegrationError("Wait a moment and try again.", 429);
      let input: z.infer<typeof schema> | undefined;
      if (writing) {
        if (!request.headers.get("content-type")?.includes("application/json")) throw new IntegrationError("Send a JSON request.", 415);
        let raw: unknown;
        try { raw = await readLimitedJson(request.body, 2_110_000); } catch { throw new IntegrationError("The photo is too large.", 413); }
        const parsed = schema.safeParse(raw);
        if (!parsed.success) throw new IntegrationError("Check the photo and revision.");
        input = { ...parsed.data, imageData: await prepareModelPhoto(parsed.data.imageData) };
      }
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("set local lock_timeout='5s'");
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`capsule:${userId}`]);
        if (hash) await authenticateToken(client, hash, scopes, true);
        if (!(await client.query('select id from public."user" where id=$1', [userId])).rows.length) throw new IntegrationError("Sign in again.", 401);
        const row = (await client.query<{ image_data: string | null; revision: string }>("select image_data,revision from capsule_model_photos where user_id=$1", [userId])).rows[0];
        let photo = { imageData: row?.image_data ?? null, revision: Number(row?.revision ?? 0) };
        if (input) {
          if (input.expectedRevision !== photo.revision) {
            // A retry after a lost response is safe, but never overwrite a newer photo.
            if (input.imageData !== photo.imageData) throw new IntegrationError("Your model photo changed on another device. Reload it and try again.", 409, "REVISION_CONFLICT");
          } else {
            const saved = await client.query<{ revision: string }>("insert into capsule_model_photos(user_id,image_data) values($1,$2) on conflict(user_id) do update set image_data=excluded.image_data,revision=nextval('capsule_sync_revision'),updated_at=now() returning revision", [userId, input.imageData]);
            photo = { imageData: input.imageData, revision: Number(saved.rows[0].revision) };
          }
        }
        await client.query("commit");
        return reply(photo);
      } catch (error) { await client.query("rollback").catch(() => {}); throw error; }
      finally { client.release(); }
    } catch (error) { return modelPhotoFailure(error); }
  };
}
