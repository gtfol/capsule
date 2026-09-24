import { outfitRequest } from "@/lib/server/outfit-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export function POST(request: Request) { return outfitRequest(request, "render"); }
