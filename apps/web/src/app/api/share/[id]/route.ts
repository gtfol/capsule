import { createShareHandlers } from "@/lib/server/share-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createShareHandlers();
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return handlers.inspect(request, (await context.params).id); }
export async function PUT(request: Request, context: Context) { return handlers.update(request, (await context.params).id); }
export async function PATCH(request: Request, context: Context) { return handlers.changeExpiry(request, (await context.params).id); }
export async function DELETE(request: Request, context: Context) { return handlers.remove(request, (await context.params).id); }
