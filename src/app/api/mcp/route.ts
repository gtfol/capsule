import { handleCapsuleMcp } from "@/lib/server/mcp-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function handle(request:Request) {
  return handleCapsuleMcp(request,{
    apiToken:process.env.CAPSULE_MCP_API_TOKEN,
    accessKey:process.env.CAPSULE_MCP_ACCESS_KEY,
  });
}
export const POST=handle;
export const GET=handle;
export const DELETE=handle;
