import { integrationRequest } from "@/lib/server/integration-routes";
export const runtime = "nodejs";
export const maxDuration = 60;
export function POST(request: Request) { return integrationRequest(request,"wardrobe"); }
