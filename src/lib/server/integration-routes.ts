import { getPool } from "./db";
import { getAuth } from "./auth";
import { createIntegrationHandlers } from "./integration-api";
import { createIntegrationTokenHandlers } from "./integration-token-api";
import { integrationFailure } from "./integration-tokens";

let handlers: ReturnType<typeof createIntegrationHandlers> | undefined;
export async function integrationRequest(request: Request, kind: "lookup" | "wishlist" | "wardrobe" | "purchase" | "update-wishlist" | "update-wardrobe" | "delete-wardrobe" | "wardrobe-item", id?: string, view?: string) {
  try {
    handlers ??= createIntegrationHandlers(getPool());
    return await (kind === "lookup" ? handlers.lookup(request) : kind === "wardrobe-item" ? handlers.wardrobeItem(request,id!,view) : handlers.write(request,kind,id));
  } catch(error) { return integrationFailure(error); }
}
export async function integrationTokensRequest(request: Request) {
  try {
    return await createIntegrationTokenHandlers(getPool(),async req=>(await getAuth()?.api.getSession({headers:req.headers,query:{disableCookieCache:true}}))?.user.id ?? null)(request);
  } catch(error) { return integrationFailure(error); }
}
