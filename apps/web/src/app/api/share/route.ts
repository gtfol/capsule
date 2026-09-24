import { createShareHandlers } from "@/lib/server/share-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createShareHandlers();
export const GET = handlers.status;
export const POST = handlers.create;
