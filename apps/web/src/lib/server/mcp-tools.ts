import { createHash } from "node:crypto";
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { integrationCreateSchema, integrationFieldsSchema } from "../integration-input";
import { readLimitedJson } from "./render";

const API = "https://capsule.gtfol.dev/api/v1";
const MAX_BODY_BYTES = 3_800_000;
const MAX_RESPONSE_BYTES = 100_000;
export const MCP_API_TOKEN_PATTERN = /^capsule_[A-Za-z0-9_-]{43}$/;
const tools = {create_wardrobe_item:"wardrobe", create_wishlist_item:"wishlist"} as const;
const idempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/).optional().describe("Reuse one key for every retry of the same action. Omit to derive a stable key from the collection and normalized fields. Supply a new unique key for a separate intentional action with identical fields.");
const inputSchema = integrationFieldsSchema.extend({
  fetch: z.boolean().default(true).describe("Fetch the product page when a URL is provided. Set false to supply details directly; name is then required."),
  idempotencyKey,
});
const receiptSchema = z.object({
  id:z.uuid(), collection:z.enum(["wardrobe","wishlist"]), duplicate:z.boolean(),
  sync:z.object({status:z.literal("saved_to_cloud"),revision:z.number().int().nonnegative().safe(),devices:z.literal("pending")}),
});
const lookupSchema = z.object({items:z.array(z.object({id:z.uuid(),collection:z.enum(["wardrobe","wishlist"]),revision:z.number().int().nonnegative().safe()}))});

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>`${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

function failure(code: string, message: string, extra: Record<string,unknown> = {}): CallToolResult {
  return output({ok:false,error:{code,message},...extra},true);
}
function output(value: Record<string,unknown>, isError = false): CallToolResult {
  return {isError,content:[{type:"text",text:JSON.stringify(value)}],structuredContent:value};
}

export type CapsuleMcpOptions = { apiToken: string; fetcher?: typeof fetch; secrets?: string[] };

export function createCapsuleTools({apiToken,fetcher=fetch,secrets=[]}: CapsuleMcpOptions) {
  // Credentials live in this server closure, never in schemas or tool output.
  const privateValues = [apiToken,...secrets].filter(Boolean);
  async function request(path: string, options: RequestInit, signal: AbortSignal) {
    const response = await fetcher(`${API}${path}`,{
      ...options,headers:{...options.headers,Authorization:`Bearer ${apiToken}`},
      signal,cache:"no-store",redirect:"error",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(()=>{});
      return {status:response.status,data:undefined};
    }
    return {status:response.status,data:await readLimitedJson(response.body,MAX_RESPONSE_BYTES)};
  }

  return async function call(name: string, args: unknown, callerSignal?: AbortSignal): Promise<CallToolResult> {
    if (!Object.hasOwn(tools,name)) return failure("UNKNOWN_TOOL","This tool is not available.");
    if (!MCP_API_TOKEN_PATTERN.test(apiToken)) return failure("NOT_CONFIGURED","The server's Capsule integration token is not configured.");
    // Reject credentials in any argument, including idempotency keys, before
    // they could be stored in the REST receipts or echoed by a validation error.
    let serialized: string;
    try { serialized=JSON.stringify(args) ?? ""; }
    catch { return failure("INVALID_INPUT","Provide a JSON object with item fields."); }
    if (privateValues.some(secret=>serialized.includes(secret))) return failure("PRIVATE_INPUT","Credentials must not appear in tool arguments.");
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) return failure("INVALID_INPUT","Check the item fields and idempotency key against the tool schema.");
    const {idempotencyKey: suppliedKey,...fields}=parsed.data;
    const normalized=integrationCreateSchema.safeParse(fields);
    if (!normalized.success) return failure("INVALID_INPUT","Provide a product URL, or a name with fetch set to false.");
    const collection=tools[name as keyof typeof tools];
    const body=JSON.stringify(normalized.data);
    if (Buffer.byteLength(body)>MAX_BODY_BYTES) return failure("INVALID_INPUT","The item and uploaded photos exceed the 3,800,000-byte request limit.");
    const key=suppliedKey ?? `mcp-v1-${createHash("sha256").update(canonical({collection,body:normalized.data})).digest("hex")}`;
    const context={idempotencyKey:key,collection};
    const signal=AbortSignal.any([AbortSignal.timeout(90_000),...(callerSignal ? [callerSignal] : [])]);

    // Prove read access before writing. A write-only token must not create an
    // item that the wrapper cannot subsequently verify.
    try {
      const preflight=await request(`/items?collection=${collection}&id=00000000-0000-4000-8000-000000000000`,{method:"GET"},signal);
      if (preflight.status!==200 || !lookupSchema.safeParse(preflight.data).success) {
        return failure("READ_ACCESS_REQUIRED","No write was attempted. Check the server token and its Look up pieces permission.",{...context,writeStatus:"not_attempted"});
      }
    } catch { return failure("PREFLIGHT_FAILED","No write was attempted. Retry with the same arguments and key.",{...context,writeStatus:"not_attempted"}); }

    let receipt: z.infer<typeof receiptSchema>;
    try {
      const created=await request(`/${collection}`,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key},body},signal);
      if (created.status!==200) {
        const known: Record<number,[string,string]>={
          400:["INVALID_INPUT","Capsule rejected the item fields or photos."],
          401:["UNAUTHORIZED","The server's Capsule token is invalid, expired, or revoked."],
          403:["INSUFFICIENT_SCOPE","The server's Capsule token needs write access to this collection."],
          409:["IDEMPOTENCY_CONFLICT","This key was already used for another request. Use the original fields when retrying."],
          429:["RATE_LIMITED","Capsule's request limit was reached. Wait before retrying with the same key."],
        };
        const error=known[created.status];
        return failure(error?.[0] ?? "WRITE_UNCONFIRMED",error?.[1] ?? "The write could not be confirmed. Retry with the same arguments and key.",{
          ...context,writeStatus:error ? "rejected" : "unknown",
        });
      }
      const validated=receiptSchema.safeParse(created.data);
      if (!validated.success || validated.data.collection!==collection) throw new Error("Invalid receipt");
      receipt=validated.data;
    } catch { return failure("WRITE_UNCONFIRMED","The write may have completed. Retry with the same arguments and key; do not generate a new key.",{...context,writeStatus:"unknown"}); }

    const saved={...context,id:receipt.id,duplicate:receipt.duplicate,sync:receipt.sync,writeStatus:"saved_to_cloud"};
    try {
      const verified=await request(`/items?collection=${collection}&id=${encodeURIComponent(receipt.id)}`,{method:"GET"},signal);
      const parsedLookup=lookupSchema.safeParse(verified.data);
      const item=parsedLookup.success ? parsedLookup.data.items.find(item=>item.id===receipt.id && item.collection===collection && item.revision>=receipt.sync.revision) : undefined;
      if (verified.status!==200 || !item) throw new Error("Verification failed");
      return output({ok:true,...saved,verification:{status:"verified",revision:item.revision}});
    } catch {
      return failure("VERIFICATION_FAILED","Capsule accepted the write, but the follow-up lookup did not confirm the item. Retry with the same arguments and key.",{
        ...saved,verification:{status:"unconfirmed"},
      });
    }
  };
}

export function createCapsuleMcpServer(options: CapsuleMcpOptions) {
  const server=new Server({name:"capsule",version:"1.0.0"},{capabilities:{tools:{}}});
  const call=createCapsuleTools(options);
  const schema=z.toJSONSchema(inputSchema,{target:"draft-7"});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:Object.entries(tools).map(([name,collection])=>({
    name,title:collection==="wardrobe" ? "Add to wardrobe" : "Add to wishlist",
    description:`Create a ${collection} item through Capsule's REST API, then verify its ID with a GET. Requires server-configured read and ${collection} write access. Returns verified success only after lookup. Reuse idempotencyKey (or identical fields for an automatic key) on every retry. A separate intentional action with identical fields needs a new explicit key.`,
    inputSchema:{...schema,type:"object" as const},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true},
  }))}));
  // Low-level registration keeps schema errors generic rather than reflecting
  // untrusted inputs (or credentials accidentally pasted into them).
  server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>call(request.params.name,request.params.arguments,extra.signal));
  return server;
}
