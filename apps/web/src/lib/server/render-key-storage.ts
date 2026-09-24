import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { dbConfigured, getPool } from "./db";

export class RenderKeyError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "RenderKeyError"; }
}

export function validateRenderKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (!/^sk-[A-Za-z0-9_-]{16,500}$/.test(key)) throw new RenderKeyError("Enter an OpenAI API key beginning with sk-.");
  return key;
}

function encryptionKey(value: string | undefined): Buffer {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value, "base64").length !== 32 || Buffer.from(value, "base64").toString("base64") !== value) {
    throw new RenderKeyError("Saving API keys is not available right now.", 503);
  }
  return Buffer.from(value, "base64");
}
export function renderKeyStorageConfigured(): boolean {
  try { encryptionKey(process.env.RENDER_KEY_ENCRYPTION_KEY); return dbConfigured(); } catch { return false; }
}
const context = (userId: string) => Buffer.from(`capsule:openai-key:v1:${userId}`, "utf8");
export function encryptRenderKey(userId: string, key: string, secret: string | undefined): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(context(userId));
  const ciphertext = Buffer.concat([cipher.update(validateRenderKey(key), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}
export function decryptRenderKey(userId: string, envelope: string, secret: string | undefined): string {
  const key = encryptionKey(secret);
  try {
    if (envelope.length > 900) throw new Error();
    const parts = envelope.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") throw new Error();
    const [iv, tag, ciphertext] = parts.slice(1).map((part) => {
      const bytes = Buffer.from(part, "base64");
      if (!part || bytes.toString("base64") !== part) throw new Error();
      return bytes;
    });
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(context(userId)); decipher.setAuthTag(tag);
    return validateRenderKey(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
  } catch { throw new RenderKeyError("Your saved API key could not be opened. Replace it in your account to continue.", 503); }
}

type Query = (sql: string, values: string[]) => Promise<{ rows: { encrypted_key?: string }[] }>;
export function createRenderKeyStore(query: Query, secret: () => string | undefined) {
  return {
    async has(userId: string) {
      const result = await query("select 1 from capsule_render_keys where user_id = $1", [userId]);
      return result.rows.length > 0;
    },
    async save(userId: string, key: string) {
      const encrypted = encryptRenderKey(userId, key, secret());
      await query("insert into capsule_render_keys (user_id, encrypted_key) values ($1, $2) on conflict (user_id) do update set encrypted_key = excluded.encrypted_key, updated_at = now()", [userId, encrypted]);
    },
    async remove(userId: string) { await query("delete from capsule_render_keys where user_id = $1", [userId]); },
    async load(userId: string) {
      const result = await query("select encrypted_key from capsule_render_keys where user_id = $1", [userId]);
      return result.rows[0]?.encrypted_key ? decryptRenderKey(userId, result.rows[0].encrypted_key, secret()) : null;
    },
  };
}
export const renderKeyStore = createRenderKeyStore(async (sql, values) => getPool().query(sql, values), () => process.env.RENDER_KEY_ENCRYPTION_KEY);
