import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { CATEGORIES } from "../types";
import { SOURCE_KEY_PATTERN } from "../piece-identity";
import { DEFAULT_SHARE_EXPIRY, MAX_SHARE_BODY_BYTES, MAX_SHARED_PIECES, SHARE_EXPIRIES, type ShareExpiry, type ShareMetadata, type SharePublicRecord, type ShareSnapshot } from "../share-types";
import { dbConfigured, getPool } from "./db";

export class ShareError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "ShareError"; }
}

export function validateShareId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(value) || Buffer.from(value, "base64url").toString("base64url") !== value) {
    throw new ShareError("This share link is invalid.", 400);
  }
  return value;
}
export function validateShareToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value) || Buffer.from(value, "base64url").toString("base64url") !== value) {
    throw new ShareError("This browser cannot manage that share link.", 403);
  }
  return value;
}
export const hashShareToken = (token: string) => createHash("sha256").update(validateShareToken(token)).digest("hex");
export function shareExpiry(value: unknown = DEFAULT_SHARE_EXPIRY): ShareExpiry {
  const parsed = z.enum(SHARE_EXPIRIES).safeParse(value);
  if (!parsed.success) throw new ShareError("Choose a valid link expiration.");
  return parsed.data;
}
export function shareExpiresAt(expiry: ShareExpiry, now: number): number | null {
  return expiry === "never" ? null : now + (expiry === "7d" ? 7 : 30) * 86_400_000;
}

function raster(value: string): boolean {
  const match = /^data:image\/(jpeg|png|webp|avif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return false;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.toString("base64") !== match[2]) return false;
  if (match[1] === "jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (match[1] === "png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (match[1] === "webp") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (bytes.length < 16 || bytes.toString("ascii", 4, 8) !== "ftyp") return false;
  const boxLength = bytes.readUInt32BE(0);
  if (boxLength < 16 || boxLength > bytes.length) return false;
  for (let offset = 8; offset + 4 <= Math.min(boxLength, 64); offset += 4) {
    if (offset === 12) continue; // The minor version is not a brand.
    if (["avif", "avis"].includes(bytes.toString("ascii", offset, offset + 4))) return true;
  }
  return false;
}
const rasterSchema = z.string().max(MAX_SHARE_BODY_BYTES).refine(raster);
const purchaseUrlSchema = z.string().max(8000).refine((value) => {
  if (value === "") return true;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
});
const pieceSchema = z.object({
  sourceKey: z.string().regex(SOURCE_KEY_PATTERN).optional(),
  name: z.string().trim().min(1).max(500), brand: z.string().max(300), category: z.enum(CATEGORIES),
  size: z.string().max(100), color: z.string().max(200), price: z.string().max(100), currency: z.string().max(20),
  description: z.string().max(10_000), purchaseUrl: purchaseUrlSchema,
  imageData: rasterSchema, backImageData: rasterSchema.optional(), sideImageData: rasterSchema.optional(),
  rating: z.number().min(0).max(5).refine((value) => Number.isInteger(value * 2)).nullable().optional(),
}).strict();
const snapshotSchema = z.object({
  version: z.literal(1), kind: z.enum(["wardrobe", "wishlist", "piece", "outfit"]),
  title: z.string().trim().min(1).max(500), pieces: z.array(pieceSchema).max(MAX_SHARED_PIECES),
  outfitImageData: rasterSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.kind === "outfit") {
    if (!value.outfitImageData || value.pieces.length > 6) context.addIssue({ code: "custom", message: "Invalid outfit snapshot." });
  } else {
    if (value.outfitImageData !== undefined || value.pieces.length < 1 || (value.kind === "piece" && value.pieces.length !== 1)) {
      context.addIssue({ code: "custom", message: "Invalid collection snapshot." });
    }
  }
});
export function validateShareSnapshot(value: unknown): ShareSnapshot {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) throw new ShareError("The shared selection is invalid. Try preparing the link again.");
  if (Buffer.byteLength(JSON.stringify(parsed.data)) > MAX_SHARE_BODY_BYTES) throw new ShareError("This shared selection is too large. Try sharing fewer pieces.", 413);
  return parsed.data;
}

// A keyed digest avoids retaining either raw IPs or enumerable unsalted IP
// hashes. Rotating the server connection secret simply resets these limits.
export function hashShareIp(request: Request, secret: string): string {
  const forwarded = request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? "";
  const candidate = forwarded.split(",")[0].trim();
  const address = isIP(candidate) ? candidate.toLowerCase() : "unavailable";
  return createHmac("sha256", secret).update(`capsule:share-rate:v1:${address}`).digest("hex");
}

export type ShareQuery = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
export interface ShareDatabase {
  query: ShareQuery;
  connect: () => Promise<{ query: ShareQuery; release: () => void }>;
}
type ShareRow = {
  id: string; token_hash: string; snapshot: ShareSnapshot | null; expiry: ShareExpiry;
  expires_at: Date | string | null; updated_at: Date | string; revoked_at: Date | string | null;
};
function row(value: Record<string, unknown> | undefined): ShareRow | undefined { return value as ShareRow | undefined; }
function timestamp(value: Date | string): number { return new Date(value).getTime(); }
function active(value: ShareRow, now: number): boolean {
  return !value.revoked_at && value.snapshot !== null && (value.expires_at === null || timestamp(value.expires_at) > now);
}
function metadata(value: ShareRow): ShareMetadata {
  return { id: value.id, expiry: value.expiry, expiresAt: value.expires_at === null ? null : timestamp(value.expires_at), updatedAt: timestamp(value.updated_at) };
}
function requireOwner(value: ShareRow | undefined, hash: string): ShareRow {
  if (!value) throw new ShareError("This share link is no longer available.", 410);
  const actual = Buffer.from(value.token_hash, "hex"), expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ShareError("This browser cannot manage that share link.", 403);
  return value;
}
function requireActive(value: ShareRow, now: number) {
  if (!active(value, now)) throw new ShareError("This share link is no longer available. Create a new link to share again.", 410);
}

export function createShareStore(database: ShareDatabase, clock: () => number = Date.now) {
  async function transaction<T>(id: string, callback: (query: ShareQuery) => Promise<T>): Promise<T> {
    const connection = await database.connect();
    try {
      await connection.query("begin");
      // The same lock protects missing IDs too: a revoke can win a race with
      // the initial POST and leave a tombstone that no retry can overwrite.
      await connection.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`capsule:share:${id}`]);
      const result = await callback(connection.query);
      await connection.query("commit");
      return result;
    } catch (error) {
      try { await connection.query("rollback"); } catch { /* Preserve the original failure. */ }
      throw error;
    } finally { connection.release(); }
  }
  async function cleanup() {
    // Bounded, opportunistic cleanup also runs on public reads. Tombstones are
    // retained, so neither expiry nor revocation permits an old POST retry.
    try {
      await database.query(`with expired as (
        select id from public.capsule_shares where expires_at <= $1 and snapshot is not null
        order by expires_at limit 50 for update skip locked
      ) update public.capsule_shares set snapshot = null where id in (select id from expired)`, [new Date(clock())]);
      await database.query("delete from public.capsule_share_limits where window_start < $1", [new Date(clock() - 2 * 3_600_000)]);
    } catch { /* Cleanup cannot prevent reading or revoking a share. */ }
  }
  async function limit(query: ShareQuery, ipHash: string, now: number) {
    if (!/^[a-f0-9]{64}$/.test(ipHash)) throw new ShareError("Sharing is unavailable right now.", 503);
    const result = await query(`insert into public.capsule_share_limits (ip_hash, window_start, creations)
      values ($1, $2, 1) on conflict (ip_hash) do update set
        window_start = case when capsule_share_limits.window_start <= $2 - interval '1 hour' then $2 else capsule_share_limits.window_start end,
        creations = case when capsule_share_limits.window_start <= $2 - interval '1 hour' then 1 else capsule_share_limits.creations + 1 end
      where capsule_share_limits.window_start <= $2 - interval '1 hour' or capsule_share_limits.creations < 10
      returning ip_hash`, [ipHash, new Date(now)]);
    if (!result.rows.length) throw new ShareError("You have created several share links recently. Try again in an hour.", 429);
  }
  const find = async (query: ShareQuery, id: string) => row((await query("select id, token_hash, snapshot, expiry, expires_at, updated_at, revoked_at from public.capsule_shares where id = $1 for update", [id])).rows[0]);
  return {
    async configured(): Promise<boolean> {
      try {
        const result = await database.query("select to_regclass('public.capsule_shares') is not null and to_regclass('public.capsule_share_limits') is not null as ready");
        return result.rows[0]?.ready === true;
      } catch { return false; }
    },
    async create(id: string, token: string, input: unknown, expiry: ShareExpiry, ipHash: string): Promise<ShareMetadata> {
      validateShareId(id); const hash = hashShareToken(token); const snapshot = validateShareSnapshot(input); shareExpiry(expiry);
      const result = await transaction(id, async (query) => {
        const now = clock(); const existing = await find(query, id);
        if (existing) { const owned = requireOwner(existing, hash); requireActive(owned, now); return metadata(owned); }
        await limit(query, ipHash, now);
        const expiresAt = shareExpiresAt(expiry, now);
        await query("insert into public.capsule_shares (id, token_hash, snapshot, expires_at, updated_at, expiry) values ($1, $2, $3::jsonb, $4, $5, $6)", [id, hash, JSON.stringify(snapshot), expiresAt === null ? null : new Date(expiresAt), new Date(now), expiry]);
        return { id, expiry, expiresAt, updatedAt: now };
      });
      await cleanup(); return result;
    },
    async update(id: string, token: string, input: unknown): Promise<ShareMetadata> {
      validateShareId(id); const hash = hashShareToken(token); const snapshot = validateShareSnapshot(input);
      const result = await transaction(id, async (query) => {
        const now = clock(); const existing = requireOwner(await find(query, id), hash); requireActive(existing, now);
        await query("update public.capsule_shares set snapshot = $2::jsonb, updated_at = $3 where id = $1 and token_hash = $4 and revoked_at is null", [id, JSON.stringify(snapshot), new Date(now), hash]);
        return { ...metadata(existing), updatedAt: now };
      });
      await cleanup(); return result;
    },
    async changeExpiry(id: string, token: string, expiry: ShareExpiry): Promise<ShareMetadata> {
      validateShareId(id); const hash = hashShareToken(token); shareExpiry(expiry);
      return transaction(id, async (query) => {
        const now = clock(); const existing = requireOwner(await find(query, id), hash); requireActive(existing, now);
        const expiresAt = shareExpiresAt(expiry, now);
        await query("update public.capsule_shares set expires_at = $2, updated_at = $3, expiry = $5 where id = $1 and token_hash = $4 and revoked_at is null", [id, expiresAt === null ? null : new Date(expiresAt), new Date(now), hash, expiry]);
        return { id, expiry, expiresAt, updatedAt: now };
      });
    },
    async remove(id: string, token: string, ipHash: string): Promise<void> {
      validateShareId(id); const hash = hashShareToken(token);
      await transaction(id, async (query) => {
        const now = clock(); const existing = await find(query, id);
        if (!existing) {
          await limit(query, ipHash, now);
          await query("insert into public.capsule_shares (id, token_hash, snapshot, expires_at, revoked_at, updated_at) values ($1, $2, null, null, $3, $3)", [id, hash, new Date(now)]);
        } else {
          requireOwner(existing, hash);
          if (!existing.revoked_at) await query("update public.capsule_shares set snapshot = null, revoked_at = $2, updated_at = $2 where id = $1 and token_hash = $3", [id, new Date(now), hash]);
        }
      });
      await cleanup();
    },
    async inspect(id: string, token: string): Promise<ShareMetadata> {
      validateShareId(id); const hash = hashShareToken(token);
      const existing = requireOwner(row((await database.query("select id, token_hash, snapshot, expiry, expires_at, updated_at, revoked_at from public.capsule_shares where id = $1", [id])).rows[0]), hash);
      requireActive(existing, clock());
      return metadata(existing);
    },
    async get(id: string): Promise<SharePublicRecord | null> {
      try { validateShareId(id); } catch { return null; }
      const result = await database.query("select snapshot, expires_at, updated_at from public.capsule_shares where id = $1 and revoked_at is null and snapshot is not null and (expires_at is null or expires_at > $2)", [id, new Date(clock())]);
      await cleanup();
      const value = result.rows[0];
      if (!value) return null;
      try {
        return { snapshot: validateShareSnapshot(value.snapshot), expiresAt: value.expires_at === null ? null : timestamp(value.expires_at as Date), updatedAt: timestamp(value.updated_at as Date) };
      } catch { return null; }
    },
  };
}

export const shareStore = createShareStore({
  query: async (sql, values) => getPool().query(sql, values),
  connect: async () => {
    const client = await getPool().connect();
    return { query: async (sql, values) => client.query(sql, values), release: () => client.release() };
  },
});
export async function shareConfigured(): Promise<boolean> { return dbConfigured() && shareStore.configured(); }
