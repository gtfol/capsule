import { getPool } from "./db";
import { createOutfitHandlers } from "./outfit-api";
import { integrationFailure } from "./integration-tokens";
let handlers: ReturnType<typeof createOutfitHandlers> | undefined;
export async function outfitRequest(request: Request, action: "list" | "item" | "image" | "mutate" | "config" | "key" | "render" | "renderStatus", id?: string) {
  try {
    handlers ??= createOutfitHandlers(getPool());
    if (action === "image" || action === "item") return await handlers.item(request, id!, action === "image");
    if (action === "mutate") return await handlers.mutate(request, id!);
    if (action === "renderStatus") return await handlers.renderStatus(request, id!);
    return await handlers[action](request);
  } catch (error) { return integrationFailure(error); }
}
