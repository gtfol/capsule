import { MAX_SHARE_BODY_BYTES } from "../share-types";
import { getAuth } from "./auth";
import { hashShareIp, ShareError, shareConfigured, shareExpiry, shareStore, validateShareId, validateShareSnapshot, validateShareToken } from "./shares";

export type ShareDependencies = {
  configured: () => Promise<boolean>;
  store: typeof shareStore;
  ipHash: (request: Request) => string;
  userId: (request: Request) => Promise<string | null>;
};
export const shareDependencies: ShareDependencies = {
  configured: shareConfigured,
  store: shareStore,
  userId: async (request) => (await getAuth()?.api.getSession({ headers: request.headers }))?.user.id ?? null,
  ipHash: (request) => {
    if (!process.env.DATABASE_URL) throw new ShareError("Sharing is unavailable right now.", 503);
    return hashShareIp(request, process.env.DATABASE_URL);
  },
};
const privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
function response(value: unknown, status = 200) { return Response.json(value, { status, headers: privateHeaders }); }
function failure(error: unknown) {
  return response({ error: error instanceof ShareError ? error.message : "This share link could not be checked or updated. Try again." }, error instanceof ShareError ? error.status : 503);
}
function checkOrigin(request: Request, required: boolean) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  let expectedOrigin = url.origin;
  const host = request.headers.get("host");
  if (host) {
    // Next can normalize a loopback URL to localhost while the browser is
    // visiting 127.0.0.1. Host is the actual requested authority; forwarded
    // host headers are deliberately not used for this security check.
    let requested: URL;
    try { requested = new URL(`${url.protocol}//${host}`); }
    catch { throw new ShareError("This action must be requested from Capsule.", 403); }
    if (requested.username || requested.password || requested.pathname !== "/" || requested.search || requested.hash) throw new ShareError("This action must be requested from Capsule.", 403);
    expectedOrigin = requested.origin;
  }
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== expectedOrigin) || (required && !origin)) {
    throw new ShareError("This action must be requested from Capsule.", 403);
  }
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new ShareError("The share request is invalid.");
  }
  return value as Record<string, unknown>;
}
async function readBody(request: Request, maxBytes = MAX_SHARE_BODY_BYTES): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new ShareError("Send a JSON share request.", 415);
  if (Number(request.headers.get("content-length")) > maxBytes) throw new ShareError("This shared selection is too large. Try sharing fewer pieces.", 413);
  if (!request.body) throw new ShareError("The share request is empty.");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new ShareError("This shared selection is too large. Try sharing fewer pieces.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new ShareError("The share request could not be read."); }
}
async function requireEmptyBody(request: Request) {
  // Next may represent an empty DELETE body as a non-null, empty stream.
  const reader = request.body?.getReader();
  if (!reader) return;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value.byteLength) {
        await reader.cancel();
        throw new ShareError("A revoke request does not need a body.");
      }
    }
  } finally { reader.releaseLock(); }
}
export function createShareHandlers(deps: ShareDependencies = shareDependencies) {
  async function available() { if (!await deps.configured()) throw new ShareError("Sharing is unavailable right now.", 503); }
  return {
    async status(request: Request) {
      try { checkOrigin(request, false); return response({ enabled: await deps.configured() }); }
      catch (error) { return failure(error); }
    },
    async create(request: Request) {
      try {
        checkOrigin(request, true);
        const body = object(await readBody(request), ["id", "token", "snapshot", "expiry"]);
        const id = validateShareId(body.id), token = validateShareToken(body.token), snapshot = validateShareSnapshot(body.snapshot), expiry = shareExpiry(body.expiry);
        await available();
        return response(await deps.store.create(id, token, snapshot, expiry, deps.ipHash(request)));
      } catch (error) { return failure(error); }
    },
    async inspect(request: Request, rawId: string) {
      try {
        checkOrigin(request, false);
        const id = validateShareId(rawId), token = validateShareToken(request.headers.get("x-share-token"));
        await available();
        const { expiresAt, updatedAt, expiry, views } = await deps.store.inspect(id, token);
        return response({ exists: true, expiresAt, updatedAt, expiry, views });
      } catch (error) { return failure(error); }
    },
    async update(request: Request, rawId: string) {
      try {
        checkOrigin(request, true);
        const id = validateShareId(rawId), token = validateShareToken(request.headers.get("x-share-token"));
        const body = object(await readBody(request), ["snapshot"]);
        const snapshot = validateShareSnapshot(body.snapshot);
        await available();
        return response(await deps.store.update(id, token, snapshot));
      } catch (error) { return failure(error); }
    },
    async changeExpiry(request: Request, rawId: string) {
      try {
        checkOrigin(request, true);
        const id = validateShareId(rawId), token = validateShareToken(request.headers.get("x-share-token"));
        const body = object(await readBody(request, 1024), ["expiry"]);
        if (body.expiry === undefined) throw new ShareError("Choose a link expiration.");
        const expiry = shareExpiry(body.expiry);
        await available();
        return response(await deps.store.changeExpiry(id, token, expiry));
      } catch (error) { return failure(error); }
    },
    async remove(request: Request, rawId: string) {
      try {
        checkOrigin(request, true);
        const id = validateShareId(rawId), token = validateShareToken(request.headers.get("x-share-token"));
        await requireEmptyBody(request);
        await available(); await deps.store.remove(id, token, deps.ipHash(request));
        return response({ ok: true });
      } catch (error) { return failure(error); }
    },
    async copy(request: Request, rawId: string) {
      try {
        checkOrigin(request, true);
        const id = validateShareId(rawId);
        const body = object(await readBody(request, 2048), ["expectedUserId"]);
        const userId = await deps.userId(request);
        if (!userId) throw new ShareError("Sign in to add shared pieces to your collection.", 401);
        if (typeof body.expectedUserId !== "string" || body.expectedUserId !== userId) {
          throw new ShareError("Your signed-in account changed. Try adding these pieces again.", 409);
        }
        await available();
        const shared = await deps.store.get(id);
        if (!shared) throw new ShareError("This share link is no longer available.", 410);
        return response({ snapshot: validateShareSnapshot(shared.snapshot), userId });
      } catch (error) { return failure(error); }
    },
  };
}
