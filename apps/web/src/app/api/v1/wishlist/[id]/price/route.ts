import { integrationRequest } from "@/lib/server/integration-routes";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request, context: {params: Promise<{id:string}>}) {
  const params = await context.params;
  return integrationRequest(request,"wishlist-price",params.id);
}
