import { integrationRequest } from "@/lib/server/integration-routes";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function PATCH(request: Request, context: {params: Promise<{id:string}>}) { return integrationRequest(request,"update-wishlist",(await context.params).id); }

export async function GET(request: Request, context: {params: Promise<{id:string}>}) { return integrationRequest(request,"wishlist-item",(await context.params).id); }
export async function DELETE(request: Request, context: {params: Promise<{id:string}>}) { return integrationRequest(request,"delete-wishlist",(await context.params).id); }
