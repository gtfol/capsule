import { createShareHandlers } from "@/lib/server/share-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createShareHandlers();
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handlers.copy(request, (await context.params).id);
}
