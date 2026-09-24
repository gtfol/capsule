import { integrationRequest } from "@/lib/server/integration-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return integrationRequest(request,"lookup"); }
