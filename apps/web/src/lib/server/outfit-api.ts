import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import sharp from "sharp";
import { z } from "zod";
import type { Outfit } from "../types";
import { MAX_IMAGE_CHARS } from "../image-limits";
import { canonical } from "./integration-api";
import { authenticateToken, bearerHash, digest, IntegrationError, integrationFailure, type IntegrationScope } from "./integration-tokens";
import { beginRender, getRenderStatus, parseRenderInput, parseRaster, readLimitedJson, RenderError, renderOutfit } from "./render";
import { createRenderKeyStore, renderKeyStorageConfigured, renderKeyStore, RenderKeyError, validateRenderKey } from "./render-key-storage";
import { createDatabaseLimiter } from "./request-limit";
import { validateSyncRequest } from "./sync-validation";

type Row = { record: Outfit; revision: string };
type Receipt = { kind: "outfit-render"; state: "pending"; startedAt: number }
  | { kind: "outfit-render"; state: "saved"; id: string; revision: number }
  | { kind: "outfit-render"; state: "failed"; message: string };
type Dependencies = { render: typeof renderOutfit; status: typeof getRenderStatus; keys: typeof renderKeyStore; keysConfigured: () => boolean; keysFor?: (client: PoolClient) => typeof renderKeyStore };
const defaults: Dependencies = { render: renderOutfit, status: getRenderStatus, keys: renderKeyStore, keysConfigured: renderKeyStorageConfigured, keysFor: client => createRenderKeyStore((sql, values) => client.query(sql, values), () => process.env.RENDER_KEY_ENCRYPTION_KEY) };
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
const summary = ({ record, revision }: Row) => ({ id: record.id, name: record.name, itemIds: record.itemIds, createdAt: record.createdAt, updatedAt: record.updatedAt, revision: Number(revision) });
const fields = "record - 'imageData' as record, revision";
const revisionSchema = z.object({ expectedRevision: z.number().int().positive().safe() }).strict();
const editSchema = revisionSchema.extend({ name: z.string().trim().min(1).max(500) });
const renderSchema = z.object({
  name: z.string().trim().min(1).max(500), referencePhoto: z.string(), notes: z.string().max(300).optional(),
  items: z.array(z.object({ id: z.uuid(), name: z.string().max(500), category: z.enum(["tops", "jackets", "bottoms", "accessories", "shoes"]), imageData: z.string() }).strict()).min(1).max(6),
}).strict();
export async function prepareOutfitImage(bytes: Buffer) {
  for (const [edge, quality] of [[1500, 85], [1200, 75], [900, 65]]) {
    const pixels = await sharp(bytes, { limitInputPixels: 25_000_000 }).rotate()
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).jpeg({ quality }).toBuffer();
    const image = `data:image/jpeg;base64,${pixels.toString("base64")}`;
    if (image.length <= MAX_IMAGE_CHARS) return image;
  }
  throw new RenderError("The rendered image could not be saved. Try again with a smaller photo.", 422);
}
function keyFor(request: Request) {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) throw new IntegrationError("A stable idempotency key is required.");
  return key;
}
function renderReply(receipt: Receipt): Response {
  if (receipt.state === "saved") return reply(receipt);
  if (receipt.state === "failed") throw new IntegrationError(receipt.message, 422, "RENDER_FAILED");
  if (Date.now() - receipt.startedAt > 180_000) throw new IntegrationError("This render was interrupted. Check your outfits before starting another render; OpenAI may have charged for it.", 409, "RENDER_INTERRUPTED");
  return reply(receipt, 202);
}

export function createOutfitHandlers(pool: Pool, deps: Dependencies = defaults) {
  const limit = createDatabaseLimiter((sql, values) => pool.query(sql, values));
  async function auth(request: Request, scopes: IntegrationScope[]) {
    const hash = bearerHash(request);
    const token = await authenticateToken(pool, hash, scopes);
    const rate = await limit(digest(`capsule:outfits:${token.user_id}`), { count: 180, seconds: 60 });
    if (!rate.allowed) throw new IntegrationError("Wait a moment and try again.", 429, "RATE_LIMITED");
    return { hash, token, scopes };
  }
  async function locked<T>(access: Awaited<ReturnType<typeof auth>>, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local lock_timeout='5s'");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`capsule:${access.token.user_id}`]);
      await authenticateToken(client, access.hash, access.scopes, true);
      const result = await work(client);
      await client.query("update capsule_integration_tokens set last_used_at=now() where id=$1", [access.token.id]);
      await client.query("commit");
      return result;
    } catch (error) { await client.query("rollback").catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async function body(request: Request, maximum = 4096) {
    if (!request.headers.get("content-type")?.includes("application/json")) throw new IntegrationError("Send a JSON request.", 415);
    try { return await readLimitedJson(request.body, maximum); }
    catch { throw new IntegrationError("The request is invalid or too large."); }
  }
  function failure(error: unknown) {
    if (error instanceof RenderKeyError) return integrationFailure(new IntegrationError(error.message, error.status, "RENDER_KEY"));
    if (error instanceof RenderError) return integrationFailure(new IntegrationError(error.message, error.status === 401 || error.status === 403 ? 422 : error.status, "RENDER_FAILED"));
    return integrationFailure(error);
  }
  return {
    async list(request: Request) {
      try {
        const access = await auth(request, ["outfits:read"]);
        const query = new URL(request.url).searchParams, cursor = Number(query.get("cursor") ?? 0);
        if ([...query.keys()].some(key => key !== "cursor") || !Number.isSafeInteger(cursor) || cursor < 0) throw new IntegrationError("Invalid cursor.");
        return await locked(access, async client => {
          const rows = (await client.query<Row>(`select ${fields} from capsule_records where user_id=$1 and collection='outfits' and coalesce((record->>'deletedAt')::bigint,0)=0 and revision>$2 order by revision limit 101`, [access.token.user_id, cursor])).rows;
          const page = rows.slice(0, 100);
          return reply({ outfits: page.map(summary), cursor: page.length ? Number(page.at(-1)!.revision) : cursor, hasMore: rows.length > 100 });
        });
      } catch (error) { return failure(error); }
    },
    async item(request: Request, id: string, image = false) {
      try {
        const access = await auth(request, ["outfits:read"]);
        if (!z.uuid().safeParse(id).success) throw new IntegrationError("Invalid outfit.");
        return await locked(access, async client => {
          const row = (await client.query<Row>("select record,revision from capsule_records where user_id=$1 and collection='outfits' and id=$2 and coalesce((record->>'deletedAt')::bigint,0)=0", [access.token.user_id, id])).rows[0];
          if (!row) throw new IntegrationError("This outfit was removed.", 404, "NOT_FOUND");
          if (!image) return reply({ outfit: summary(row) });
          const raster = parseRaster(row.record.imageData, 3_000_000);
          return new Response(new Uint8Array(raster.bytes), { headers: { "Content-Type": raster.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
        });
      } catch (error) { return failure(error); }
    },
    async mutate(request: Request, id: string) {
      try {
        const removing = request.method === "DELETE";
        const access = await auth(request, [removing ? "outfits:delete" : "outfits:write"]);
        if (!z.uuid().safeParse(id).success) throw new IntegrationError("Invalid outfit.");
        const parsed = (removing ? revisionSchema : editSchema).safeParse(await body(request));
        if (!parsed.success) throw new IntegrationError("Check the outfit name and revision.");
        const key = keyFor(request), hash = digest(canonical({ kind: removing ? "outfit-delete" : "outfit-edit", id, body: parsed.data }));
        return await locked(access, async client => {
          const userId = access.token.user_id;
          const prior = (await client.query<{ request_hash: string; response: unknown }>("select request_hash,response from capsule_integration_receipts where user_id=$1 and key=$2", [userId, key])).rows[0];
          if (prior) {
            if (prior.request_hash !== hash) throw new IntegrationError("This key belongs to another request.", 409, "IDEMPOTENCY_CONFLICT");
            return reply(prior.response);
          }
          const row = (await client.query<Row>("select record,revision from capsule_records where user_id=$1 and collection='outfits' and id=$2", [userId, id])).rows[0];
          if (!row || row.record.deletedAt) throw new IntegrationError("This outfit was removed.", 404, "NOT_FOUND");
          if (Number(row.revision) !== parsed.data.expectedRevision) throw new IntegrationError("This outfit changed. Reload it before saving.", 409, "REVISION_CONFLICT");
          const record = { ...row.record, updatedAt: Date.now(), ...(removing ? { deletedAt: Date.now(), imageData: "" } : { name: (parsed.data as z.infer<typeof editSchema>).name }) };
          const changed = await client.query<{ revision: string }>("update capsule_records set record=$3::jsonb,revision=nextval('capsule_sync_revision') where user_id=$1 and collection='outfits' and id=$2 returning revision", [userId, id, JSON.stringify(record)]);
          const response = { id, revision: Number(changed.rows[0].revision) };
          await client.query("insert into capsule_integration_receipts(user_id,key,request_hash,response) values($1,$2,$3,$4::jsonb)", [userId, key, hash, JSON.stringify(response)]);
          return reply(response);
        });
      } catch (error) { return failure(error); }
    },
    async config(request: Request) {
      try {
        const access = await auth(request, ["outfits:write"]);
        return await locked(access, async client => reply({ ...deps.status(), keyStorageAvailable: deps.keysConfigured(), hasSavedKey: deps.keysConfigured() && await (deps.keysFor?.(client) ?? deps.keys).has(access.token.user_id) }));
      } catch (error) { return failure(error); }
    },
    async key(request: Request) {
      try {
        const access = await auth(request, ["outfits:write"]);
        const removing = request.method === "DELETE";
        const parsed = (removing ? z.object({}).strict() : z.object({ apiKey: z.string().max(520) }).strict()).safeParse(await body(request, 2048));
        if (!parsed.success) throw new IntegrationError("Enter a valid OpenAI API key.");
        if (!removing && !deps.keysConfigured()) throw new RenderKeyError("Saving API keys is unavailable.", 503);
        // The actual write uses this transaction so account deletion cannot race it.
        const key = removing ? null : validateRenderKey((parsed.data as unknown as { apiKey: string }).apiKey);
        return await locked(access, async client => {
          const store = deps.keysFor?.(client) ?? deps.keys;
          if (key) await store.save(access.token.user_id, key); else await store.remove(access.token.user_id);
          return reply({ saved: !removing });
        });
      } catch (error) { return failure(error); }
    },
    async renderStatus(request: Request, key: string) {
      try {
        const access = await auth(request, ["outfits:read", "outfits:write"]);
        if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) throw new IntegrationError("Invalid render request.");
        return await locked(access, async client => {
          const receipt = (await client.query<{ response: Receipt }>("select response from capsule_integration_receipts where user_id=$1 and key=$2", [access.token.user_id, key])).rows[0]?.response;
          if (!receipt || receipt.kind !== "outfit-render") throw new IntegrationError("This render has not started.", 404, "NOT_FOUND");
          return renderReply(receipt);
        });
      } catch (error) { return failure(error); }
    },
    async render(request: Request) {
      let claimed: { userId: string; key: string } | undefined;
      let finish: (() => void) | undefined;
      try {
        const access = await auth(request, ["items:read", "outfits:read", "outfits:write"]);
        const key = keyFor(request);
        const parsed = renderSchema.safeParse(await body(request, 3_800_000));
        if (!parsed.success) throw new IntegrationError("Choose one to six wardrobe pieces and a model photo.");
        const input = parsed.data, userId = access.token.user_id;
        const hash = digest(canonical({ kind: "outfit-render", body: input }));
        const previous = await locked(access, async client => {
          const saved = (await client.query<{ request_hash: string; response: Receipt }>("select request_hash,response from capsule_integration_receipts where user_id=$1 and key=$2", [userId, key])).rows[0];
          if (saved) {
            if (saved.request_hash !== hash) throw new IntegrationError("This key belongs to another request.", 409, "IDEMPOTENCY_CONFLICT");
            return saved.response;
          }
          if (!deps.status().enabled) throw new IntegrationError("Rendering is unavailable right now.", 503, "RENDER_UNAVAILABLE");
          if (!deps.keysConfigured() || !await (deps.keysFor?.(client) ?? deps.keys).has(userId)) throw new IntegrationError("Add an OpenAI key in settings to render outfits.", 422, "RENDER_KEY");
          const ids = input.items.map(item => item.id);
          if (new Set(ids).size !== ids.length) throw new IntegrationError("Choose each piece only once.");
          const owned = await client.query("select id from capsule_records where user_id=$1 and collection='items' and id=any($2::uuid[]) and coalesce((record->>'deletedAt')::bigint,0)=0", [userId, ids]);
          if (owned.rows.length !== ids.length) throw new IntegrationError("A selected piece was removed. Choose your pieces again.", 409, "PIECE_MISSING");
          const allowed = await createDatabaseLimiter((sql, values) => client.query(sql, values))(digest(`capsule:outfit-render:${userId}`), { count: 3, seconds: 300 });
          if (!allowed.allowed) throw new IntegrationError("Wait a few minutes before rendering again.", 429, "RATE_LIMITED");
          const pending: Receipt = { kind: "outfit-render", state: "pending", startedAt: Date.now() };
          await client.query("insert into capsule_integration_receipts(user_id,key,request_hash,response) values($1,$2,$3,$4::jsonb)", [userId, key, hash, JSON.stringify(pending)]);
          return null;
        });
        if (previous) return renderReply(previous);
        claimed = { userId, key };
        const apiKey = await deps.keys.load(userId);
        const renderInput = parseRenderInput({ ...input, apiKey });
        finish = beginRender(renderInput.apiKey);
        // No database transaction stays open during the paid provider request.
        const rendered = await deps.render(renderInput);
        const raster = parseRaster(rendered.imageData, 3_000_000);
        const imageData = await prepareOutfitImage(raster.bytes);
        const now = Date.now();
        const record: Outfit = { id: randomUUID(), name: input.name, itemIds: input.items.map(item => item.id), imageData, createdAt: now, updatedAt: now, deletedAt: null };
        validateSyncRequest({ expectedUserId: userId, cursor: 0, changes: [{ collection: "outfits", record, baseRevision: 0, token: randomUUID() }] });
        return await locked(access, async client => {
          const inserted = await client.query<{ revision: string }>("insert into capsule_records(user_id,collection,id,record) values($1,'outfits',$2,$3::jsonb) returning revision", [userId, record.id, JSON.stringify(record)]);
          const receipt: Receipt = { kind: "outfit-render", state: "saved", id: record.id, revision: Number(inserted.rows[0].revision) };
          await client.query("update capsule_integration_receipts set response=$3::jsonb where user_id=$1 and key=$2", [userId, key, JSON.stringify(receipt)]);
          return renderReply(receipt);
        });
      } catch (error) {
        if (claimed) {
          const message = error instanceof RenderError || error instanceof RenderKeyError ? error.message : "This render could not be saved. Check your outfits before rendering again; OpenAI may have charged for it.";
          // An uncertain commit must never overwrite a successfully saved receipt.
          await pool.query("update capsule_integration_receipts set response=$3::jsonb where user_id=$1 and key=$2 and response->>'state'='pending'", [claimed.userId, claimed.key, JSON.stringify({ kind: "outfit-render", state: "failed", message })]).catch(() => {});
        }
        return failure(error);
      } finally { finish?.(); }
    },
  };
}
