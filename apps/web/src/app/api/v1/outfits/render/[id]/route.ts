import { outfitRequest } from "@/lib/server/outfit-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return outfitRequest(request, "renderStatus", (await params).id); }
