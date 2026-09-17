import { scanRequest } from "@/lib/server/scan-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => scanRequest(request,"exchange");
