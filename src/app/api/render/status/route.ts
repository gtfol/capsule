import { getRenderStatus } from "@/lib/server/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getRenderStatus(), { headers: { "Cache-Control": "no-store" } });
}
