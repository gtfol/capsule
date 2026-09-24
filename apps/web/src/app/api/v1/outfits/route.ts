import { outfitRequest } from "@/lib/server/outfit-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return outfitRequest(request, "list"); }
