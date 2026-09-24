import { getAuth } from "./auth";
import { readLimitedJson, RenderError } from "./render";
import { RenderKeyError, renderKeyStorageConfigured, renderKeyStore, validateRenderKey } from "./render-key-storage";

export type RenderKeyDependencies = {
  userId: (request: Request) => Promise<string | null>;
  configured: () => boolean;
  store: typeof renderKeyStore;
};
export const renderKeyDependencies: RenderKeyDependencies = {
  userId: async (request) => (await getAuth()?.api.getSession({ headers: request.headers }))?.user.id ?? null,
  configured: renderKeyStorageConfigured,
  store: renderKeyStore,
};
const privateHeaders = { "Cache-Control": "no-store" };
function checkOrigin(request: Request, required = false) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin) || (required && !origin)) {
    throw new RenderKeyError("This action must be requested from Capsule.", 403);
  }
}
async function requireUser(request: Request, expected: unknown, deps: RenderKeyDependencies) {
  const userId = await deps.userId(request);
  if (!userId) throw new RenderKeyError("Sign in to save or use an account API key.", 401);
  if (typeof expected !== "string" || expected !== userId) throw new RenderKeyError("Your signed-in account changed. Reopen Outfits to continue.", 409);
  return userId;
}
function failure(error: unknown) {
  const known = error instanceof RenderKeyError;
  return Response.json({ error: known ? error.message : "Your account API key could not be checked or updated. Try again." }, { status: known ? error.status : 503, headers: privateHeaders });
}
export function createRenderKeyHandlers(deps: RenderKeyDependencies = renderKeyDependencies) {
  return {
    async GET(request: Request) {
      try {
        checkOrigin(request);
        const expected = new URL(request.url).searchParams.get("expectedUserId");
        const userId = expected ? await requireUser(request, expected, deps) : await deps.userId(request);
        const available = Boolean(userId) && deps.configured();
        return Response.json({ available, saved: available ? await deps.store.has(userId!) : false, userId }, { headers: privateHeaders });
      } catch (error) { return failure(error); }
    },
    async mutate(request: Request, remove: boolean) {
      try {
        checkOrigin(request, true);
        if (!request.headers.get("content-type")?.includes("application/json")) throw new RenderKeyError("Send a JSON key request.", 415);
        if (Number(request.headers.get("content-length")) > 2048) throw new RenderKeyError("The key request is too large.", 413);
        let body: unknown;
        try { body = await readLimitedJson(request.body, 2048); }
        catch (error) { throw new RenderKeyError("The key request could not be read.", error instanceof RenderError && error.status === 413 ? 413 : 400); }
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new RenderKeyError("The key request is invalid.");
        const value = body as Record<string, unknown>;
        const userId = await requireUser(request, value.expectedUserId, deps);
        // Removal remains possible when encryption configuration is unavailable.
        if (remove) await deps.store.remove(userId);
        else {
          if (!deps.configured()) throw new RenderKeyError("Saving API keys is not available right now.", 503);
          await deps.store.save(userId, validateRenderKey(value.apiKey));
        }
        return Response.json({ available: deps.configured(), saved: !remove, userId }, { headers: privateHeaders });
      } catch (error) { return failure(error); }
    },
  };
}

export async function resolveRenderCredential(body: unknown, request: Request, deps: RenderKeyDependencies = renderKeyDependencies): Promise<unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const value = body as Record<string, unknown>;
  if (value.useSavedKey !== true) {
    if (value.useSavedKey !== undefined || value.expectedUserId !== undefined) throw new RenderKeyError("Choose a valid rendering key source.");
    return value; // Guest keys are caller-supplied and never stored.
  }
  checkOrigin(request, true);
  if ("apiKey" in value) throw new RenderKeyError("Choose either an account key or a session key.");
  const userId = await requireUser(request, value.expectedUserId, deps);
  if (!deps.configured()) throw new RenderKeyError("Saved API keys are not available right now.", 503);
  const apiKey = await deps.store.load(userId);
  if (!apiKey) throw new RenderKeyError("Save an OpenAI API key in your account before rendering.", 409);
  return { ...value, apiKey };
}
