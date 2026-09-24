import { createHash, timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createCapsuleMcpServer, MCP_API_TOKEN_PATTERN } from "./mcp-tools";
import { readLimitedJson } from "./render";

const MAX_MCP_BYTES = 3_850_000;
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
type Config = {apiToken?:string;accessKey?:string;fetcher?:typeof fetch};
const hash=(value:string)=>createHash("sha256").update(value).digest();
const error=(message:string,status:number)=>Response.json({error:message},{status,headers:{...headers,...(status===401 ? {"WWW-Authenticate":'Bearer realm="capsule-mcp"'} : {})}});

// This is an opt-in, single-owner bridge. Its MCP access credential is separate
// from the downstream REST token and is never forwarded to the REST service.
export async function handleCapsuleMcp(request:Request,{apiToken,accessKey,fetcher}:Config) {
  if (!apiToken || !MCP_API_TOKEN_PATTERN.test(apiToken) || !accessKey || !/^[A-Za-z0-9_-]{32,256}$/.test(accessKey) || accessKey===apiToken) {
    return error("The Capsule MCP server is not configured.",503);
  }
  const authorization=/^Bearer ([A-Za-z0-9_-]{32,256})$/i.exec(request.headers.get("authorization") ?? "");
  if (!authorization || !timingSafeEqual(hash(authorization[1]),hash(accessKey))) return error("A valid MCP access key is required.",401);
  const url=new URL(request.url),origin=request.headers.get("origin");
  if (url.search || (origin && origin!==url.origin) || request.headers.get("sec-fetch-site")==="cross-site") return error("Use the MCP endpoint without query parameters from a trusted origin.",403);
  if (request.method!=="POST") return new Response(null,{status:405,headers:{...headers,Allow:"POST"}});

  let body: unknown;
  try {
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return error("Send a JSON MCP request.",415);
    body=await readLimitedJson(request.body,MAX_MCP_BYTES);
    const serialized=JSON.stringify(body);
    if (serialized.includes(apiToken) || serialized.includes(accessKey)) return error("Credentials must not appear in MCP messages.",400);
  } catch { return error("Invalid or oversized MCP request.",400); }
  const server=createCapsuleMcpServer({apiToken,fetcher,secrets:[accessKey]});
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  try {
    await server.connect(transport);
    const response=await transport.handleRequest(request,{parsedBody:body});
    for (const [name,value] of Object.entries(headers)) response.headers.set(name,value);
    return response;
  } catch { return error("The MCP request could not be completed. Retry tool calls with the same arguments and idempotency key.",503); }
  finally { await server.close().catch(()=>{}); }
}
