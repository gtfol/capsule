import { integrationRequest } from "@/lib/server/integration-routes";
export const runtime = "nodejs";
export async function GET(request: Request, context: {params: Promise<{id:string;view:string}>}) {
  const {id,view} = await context.params;
  return integrationRequest(request,"wardrobe-item",id,view);
}
