import { outfitRequest } from "@/lib/server/outfit-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function PUT(request: Request) { return outfitRequest(request, "key"); }
export function DELETE(request: Request) { return outfitRequest(request, "key"); }
