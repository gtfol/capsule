import { outfitRequest } from "@/lib/server/outfit-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return outfitRequest(request, "item", (await params).id); }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) { return outfitRequest(request, "mutate", (await params).id); }
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) { return outfitRequest(request, "mutate", (await params).id); }
