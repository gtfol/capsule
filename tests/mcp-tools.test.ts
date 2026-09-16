import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createCapsuleTools } from "../src/lib/server/mcp-tools";
import { handleCapsuleMcp } from "../src/lib/server/mcp-http";

const apiToken=`capsule_${"a".repeat(43)}`;
const accessKey="mcp-access-test-only-"+"b".repeat(43);
const id="00000000-0000-4000-8000-000000000001";
const receipt=(collection="wardrobe")=>({id,collection,duplicate:false,sync:{status:"saved_to_cloud",revision:42,devices:"pending"}});
const lookup=(collection="wardrobe",revision=42)=>({items:[{id,collection,revision}],cursor:revision,hasMore:false});
type Call={url:URL;options:RequestInit};
function mockApi(override?:(call:Call,index:number)=>Response|Promise<Response>) {
  const calls:Call[]=[];
  const fetcher:typeof fetch=async(input,options)=>{
    const call={url:new URL(String(input)),options:options!};calls.push(call);
    assert.equal(call.url.origin,"https://capsule.gtfol.dev");
    assert.equal(new Headers(options?.headers).get("authorization"),`Bearer ${apiToken}`);
    assert.equal(options?.redirect,"error");assert.equal(options?.cache,"no-store");
    if (override) return override(call,calls.length-1);
    const collection=call.options.method==="POST" ? call.url.pathname.split("/").at(-1)! : call.url.searchParams.get("collection")!;
    return Response.json(call.options.method==="POST" ? receipt(collection) : call.url.searchParams.get("id")===id ? lookup(collection) : {items:[]});
  };
  return {calls,fetcher};
}

test("both create tools POST the documented fields, then verify the returned ID with a GET",async()=>{
  for(const collection of ["wardrobe","wishlist"]) {
    const mock=mockApi();const call=createCapsuleTools({apiToken,fetcher:mock.fetcher});
    const fields={name:"Jacket",fetch:false,url:"https://shop.test/jacket",brand:"Brand",description:"Cotton",price:"40",currency:"USD",category:"jackets",size:"M",color:"Black",imageUrl:"https://shop.test/front.jpg",backImageUrl:"https://shop.test/back.jpg",sideImageData:"data:image/png;base64,cGhvdG8=",idempotencyKey:"stable-action-123"};
    const result=await call(`create_${collection}_item`,fields);
    assert.equal(result.isError,false);
    assert.deepEqual(result.structuredContent,{ok:true,idempotencyKey:fields.idempotencyKey,collection,id,duplicate:false,sync:receipt(collection).sync,writeStatus:"saved_to_cloud",verification:{status:"verified",revision:42}});
    assert.deepEqual(mock.calls.map(c=>c.options.method),["GET","POST","GET"]);
    assert.equal(mock.calls[1].url.pathname,`/api/v1/${collection}`);
    const {idempotencyKey,...body}=fields;
    assert.deepEqual(JSON.parse(mock.calls[1].options.body as string),body);
    assert.equal(new Headers(mock.calls[1].options.headers).get("idempotency-key"),idempotencyKey);
    assert.equal(mock.calls[2].url.pathname,"/api/v1/items");
    assert.equal(mock.calls[2].url.searchParams.get("id"),id);
    assert.equal(mock.calls[2].url.searchParams.get("collection"),collection);
    assert.ok(!JSON.stringify(result).includes(apiToken));
  }
});

test("automatic keys are stable across process instances, argument order and defaults; separate actions accept explicit keys",async()=>{
  const keys:string[]=[];
  for(const fields of [{url:"https://shop.test/item",name:"  Coat  "},{name:"Coat",fetch:true,url:"https://shop.test/item"}]) {
    const mock=mockApi();const result=await createCapsuleTools({apiToken,fetcher:mock.fetcher})("create_wardrobe_item",fields);
    keys.push(result.structuredContent!.idempotencyKey as string);
  }
  assert.equal(keys[0],keys[1]);assert.match(keys[0],/^mcp-v1-[a-f0-9]{64}$/);
  const mock=mockApi();const call=createCapsuleTools({apiToken,fetcher:mock.fetcher});
  const differentCollection=await call("create_wishlist_item",{name:"Coat",url:"https://shop.test/item"});
  assert.notEqual(differentCollection.structuredContent!.idempotencyKey,keys[0]);
  const explicit=await call("create_wardrobe_item",{name:"Coat",fetch:false,idempotencyKey:"another-purchase-123"});
  assert.equal(explicit.structuredContent!.idempotencyKey,"another-purchase-123");
});

test("invalid arguments and credentials never reach the API or tool output",async()=>{
  const mock=mockApi();const call=createCapsuleTools({apiToken,fetcher:mock.fetcher,secrets:[accessKey]});
  for(const args of [{},{fetch:false,url:"https://shop.test/item"},{name:"Coat",apiToken},{name:"Coat",description:apiToken},{name:"Coat",idempotencyKey:apiToken},{name:"Coat",description:accessKey},{name:"Coat",idempotencyKey:"bad"},{name:"Coat",url:"http://user:pass@shop.test"},{name:"Coat",fetch:false,sideImageData:"x".repeat(2_800_001)}]) {
    const result=await call("create_wardrobe_item",args);
    assert.equal(result.isError,true);assert.ok(!JSON.stringify(result).includes(apiToken));assert.ok(!JSON.stringify(result).includes(accessKey));
  }
  assert.equal((await call("other_tool",{name:"Coat"})).isError,true);
  assert.equal(mock.calls.length,0);
});

test("a token without read access cannot perform an unverifiable write",async()=>{
  const mock=mockApi(()=>Response.json({error:{message:apiToken}},{status:403}));
  const result=await createCapsuleTools({apiToken,fetcher:mock.fetcher})("create_wardrobe_item",{name:"Coat",fetch:false});
  assert.equal(mock.calls.length,1);assert.equal(result.structuredContent!.writeStatus,"not_attempted");
  assert.ok(!JSON.stringify(result).includes(apiToken));
});

test("timeouts and malformed write receipts return unknown outcome and the same key for safe retry",async()=>{
  for(const fail of ["timeout","malformed","wrong-collection","oversized"]) {
    const mock=mockApi((_call,index)=>{
      if(index===0) return Response.json({items:[]});
      if(fail==="timeout") throw new Error(apiToken);
      if(fail==="wrong-collection") return Response.json(receipt("wishlist"));
      if(fail==="oversized") return new Response(JSON.stringify({data:apiToken+"x".repeat(110_000)}));
      return Response.json({error:apiToken});
    });
    const result=await createCapsuleTools({apiToken,fetcher:mock.fetcher})("create_wardrobe_item",{name:"Coat",fetch:false});
    assert.equal(result.isError,true);assert.equal(result.structuredContent!.writeStatus,"unknown");
    assert.match(result.structuredContent!.idempotencyKey as string,/^mcp-v1-/);
    assert.ok(!JSON.stringify(result).includes(apiToken));
  }
});

test("failed verification distinguishes saved writes from unconfirmed writes, including wrong ID, collection, and stale revision",async()=>{
  for(const body of [{items:[]},{items:[{...lookup().items[0],id:"00000000-0000-4000-8000-000000000099"}]},lookup("wishlist"),lookup("wardrobe",41),{error:{message:apiToken}}]) {
    const mock=mockApi((_call,index)=>Response.json(index===0 ? {items:[]} : index===1 ? receipt() : body));
    const result=await createCapsuleTools({apiToken,fetcher:mock.fetcher})("create_wardrobe_item",{name:"Coat",fetch:false});
    assert.equal(result.isError,true);assert.equal(result.structuredContent!.writeStatus,"saved_to_cloud");
    assert.equal(result.structuredContent!.id,id);
    assert.deepEqual(result.structuredContent!.verification,{status:"unconfirmed"});
    assert.ok(!JSON.stringify(result).includes(apiToken));
  }
});

test("only a safe receipt and verification summary are returned even when upstream includes credentials",async()=>{
  const mock=mockApi((_call,index)=>Response.json(index===0 ? {items:[]} : index===1 ? {...receipt(),token:apiToken} : {items:[{...lookup().items[0],name:apiToken,token:apiToken}]}));
  const result=await createCapsuleTools({apiToken,fetcher:mock.fetcher})("create_wardrobe_item",{name:"Coat",fetch:false});
  assert.equal(result.isError,false);assert.ok(!JSON.stringify(result).includes(apiToken));
});

test("HTTP errors never echo REST error bodies, credentials, or exception messages",async()=>{
  for(const status of [400,401,403,409,429,500,502,503]) {
    const mock=mockApi((_call,index)=>index===0 ? Response.json({items:[]}) : Response.json({error:{message:apiToken}},{status}));
    const result=await createCapsuleTools({apiToken,fetcher:mock.fetcher})("create_wardrobe_item",{name:"Coat",fetch:false});
    assert.equal(result.isError,true);assert.ok(!JSON.stringify(result).includes(apiToken));
    if(status>=500) assert.equal(result.structuredContent!.writeStatus,"unknown");
  }
});

test("hosted MCP fails closed, requires a separate key, rejects cross-origin requests and credentials in JSON",async()=>{
  const mock=mockApi();const config={apiToken,accessKey,fetcher:mock.fetcher};
  const req=(key?:string,body:unknown={jsonrpc:"2.0",id:1,method:"tools/list"},extras:Record<string,string>={})=>new Request("https://capsule.test/api/mcp",{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream",...(key ? {authorization:`Bearer ${key}`} : {}),...extras},body:JSON.stringify(body)});
  assert.equal((await handleCapsuleMcp(req(accessKey),{})).status,503);
  assert.equal((await handleCapsuleMcp(req(accessKey),{...config,accessKey:apiToken})).status,503);
  for(const key of [undefined,"wrong-key-"+"z".repeat(40),apiToken]) assert.equal((await handleCapsuleMcp(req(key),config)).status,401);
  assert.equal((await handleCapsuleMcp(req(accessKey,undefined,{origin:"https://evil.test"}),config)).status,403);
  for(const secret of [apiToken,accessKey]) {
    const response=await handleCapsuleMcp(req(accessKey,{jsonrpc:"2.0",id:secret,method:"tools/list"}),config);
    assert.equal(response.status,400);assert.ok(!(await response.text()).includes(secret));
  }
  assert.equal(mock.calls.length,0);
});

test("the official MCP client initializes, discovers both schemas and executes tools over stateless HTTPS",async()=>{
  const mock=mockApi();const config={apiToken,accessKey,fetcher:mock.fetcher};
  const transport=new StreamableHTTPClientTransport(new URL("https://capsule.test/api/mcp"),{
    requestInit:{headers:{authorization:`Bearer ${accessKey}`}},
    fetch:async(input,options)=>handleCapsuleMcp(new Request(input,options),config),
  });
  const client=new Client({name:"capsule-test-client",version:"1.0.0"});
  try {
    await client.connect(transport);
    const listed=await client.listTools();
    assert.deepEqual(listed.tools.map(tool=>tool.name),["create_wardrobe_item","create_wishlist_item"]);
    const properties=listed.tools[0].inputSchema.properties!;
    for(const field of ["url","fetch","name","brand","description","category","size","color","price","currency","imageUrl","backImageUrl","sideImageUrl","imageData","backImageData","sideImageData","idempotencyKey"]) assert.ok(field in properties,field);
    assert.equal("token" in properties,false);assert.equal(listed.tools[0].annotations?.readOnlyHint,false);
    for(const name of ["create_wardrobe_item","create_wishlist_item"]) {
      const result=await client.callTool({name,arguments:{name:"Coat",fetch:false}});
      assert.equal(result.isError,false);assert.equal((result.structuredContent as {ok:boolean}).ok,true);
      assert.ok(!JSON.stringify(result).includes(apiToken));assert.ok(!JSON.stringify(result).includes(accessKey));
    }
  } finally {await client.close();}
});
