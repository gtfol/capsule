import { integrationRequest } from "@/lib/server/integration-routes";
export const runtime = "nodejs";
export async function POST(request: Request, context: {params: Promise<{id:string}>}) { return integrationRequest(request,"purchase",(await context.params).id); }
