import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { createCapsuleTools } from "../src/lib/server/mcp-tools";
import { createIntegrationHandlers } from "../src/lib/server/integration-api";
import { createIntegrationToken } from "../src/lib/server/integration-tokens";

const database=process.env.TEST_INTEGRATION_DATABASE_URL;
test("MCP creates and verifies real records, replays across instances and respects revocation",{skip:!database},async()=>{
  const url=new URL(database!);
  assert.equal(url.hostname,"127.0.0.1");assert.equal(url.pathname,"/capsule_integrations_test");
  const pool=new Pool({connectionString:database});const owner=crypto.randomUUID();
  try {
    await pool.query('insert into "user"(id,name,email) values ($1,$1,$2)',[owner,`${owner}@example.test`]);
    const token=await createIntegrationToken(pool,owner,"MCP test",["items:read","wardrobe:write","wishlist:write"],"never");
    const api=createIntegrationHandlers(pool,async()=>{throw new Error("Manual additions should not fetch");});
    const methods:string[]=[];
    const fetcher:typeof fetch=async(input,init)=>{
      const request=new Request(String(input),init);methods.push(request.method);
      const path=new URL(request.url).pathname;
      if(request.method==="GET") return api.lookup(request);
      assert.ok(path==="/api/v1/wardrobe" || path==="/api/v1/wishlist");
      return api.write(request,path.endsWith("/wardrobe") ? "wardrobe" : "wishlist");
    };
    for(const collection of ["wardrobe","wishlist"]) {
      const input={fetch:false,name:`MCP ${collection} jacket`,price:"80",currency:"USD",backImageUrl:"https://shop.test/back.jpg",sideImageUrl:"https://shop.test/side.jpg"};
      const first=await createCapsuleTools({apiToken:token.token,fetcher})(`create_${collection}_item`,input);
      assert.equal(first.isError,false);
      const value=first.structuredContent!;
      assert.equal(value.writeStatus,"saved_to_cloud");
      assert.equal((value.verification as {status:string}).status,"verified");
      const row=(await pool.query("select record,revision from capsule_records where user_id=$1 and id=$2",[owner,value.id])).rows[0];
      assert.equal(row.record.name,input.name);assert.equal(row.record.backImageUrl,input.backImageUrl);
      assert.equal(row.record.sideImageUrl,input.sideImageUrl);
      const replay=await createCapsuleTools({apiToken:token.token,fetcher})(`create_${collection}_item`,input);
      assert.deepEqual(replay.structuredContent,value);
      assert.equal(JSON.stringify(first).includes(token.token),false);
    }
    assert.deepEqual(methods,Array.from({length:4},()=>["GET","POST","GET"]).flat());
    assert.equal((await pool.query("select count(*)::int n from capsule_records where user_id=$1",[owner])).rows[0].n,2);
    await pool.query("update capsule_integration_tokens set revoked_at=now() where id=$1",[token.id]);
    const result=await createCapsuleTools({apiToken:token.token,fetcher})("create_wardrobe_item",{fetch:false,name:"No write"});
    assert.equal(result.isError,true);assert.equal(result.structuredContent!.writeStatus,"not_attempted");
    assert.equal(methods.at(-1),"GET");assert.equal(methods.length,13);
    assert.equal((await pool.query("select count(*)::int n from capsule_records where user_id=$1",[owner])).rows[0].n,2);
  } finally {await pool.query('delete from "user" where id=$1',[owner]);await pool.end();}
});
