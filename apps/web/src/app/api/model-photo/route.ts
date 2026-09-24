import { modelPhotoRequest } from "@/lib/server/model-photo-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => modelPhotoRequest(request, false);
export const PUT = GET;
