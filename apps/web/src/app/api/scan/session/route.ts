import { scanRequest } from "@/lib/server/scan-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => scanRequest(request,"session");
export const DELETE = (request: Request) => scanRequest(request,"session");
