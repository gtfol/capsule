import { createRenderKeyHandlers } from "@/lib/server/render-key-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createRenderKeyHandlers();
export const GET = handlers.GET;
export const PUT = (request: Request) => handlers.mutate(request, false);
export const DELETE = (request: Request) => handlers.mutate(request, true);
