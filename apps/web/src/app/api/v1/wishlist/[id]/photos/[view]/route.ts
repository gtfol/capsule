import { integrationRequest } from "@/lib/server/integration-routes";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request, context: {params: Promise<{id:string,view:string}>}) {
  const params = await context.params;
  return integrationRequest(request,"wishlist-item",params.id,params.view);
}
