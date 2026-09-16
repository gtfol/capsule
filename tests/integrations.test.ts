import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { createIntegrationHandlers, canonical } from "../src/lib/server/integration-api";
import { createIntegrationToken, bearerHash, digest, authenticateToken } from "../src/lib/server/integration-tokens";
import { createIntegrationTokenHandlers } from "../src/lib/server/integration-token-api";
import { validateSyncRequest } from "../src/lib/server/sync-validation";

const database = process.env.TEST_INTEGRATION_DATABASE_URL;
test("integration fingerprints are stable across object-key ordering; tokens never come from cookies or URLs",()=>{
  assert.equal(canonical({a:1,b:{d:2,c:3}}),canonical({b:{c:3,d:2},a:1}));
  assert.throws(()=>bearerHash(new Request("https://capsule.test/api/v1/items?token=secret",{headers:{cookie:"token=secret"}})));
});
test("integration API: account isolation, atomic moves, retries, scopes, revocation, expiry and sync compatibility",{skip:!database},async()=>{
  const url = new URL(database!); assert.equal(url.hostname,"127.0.0.1"); assert.equal(url.pathname,"/capsule_integrations_test");
  const pool = new Pool({connectionString:database,max:12});
  const owner = crypto.randomUUID(), other = crypto.randomUUID();
  const headers = {origin:"https://capsule.test","content-type":"application/json"};
  let fetches = 0;
  const product = {name:"Jacket",brand:"Example",size:"",color:"",category:"jackets" as const,price:"99",currency:"USD",description:"A jacket",purchaseUrl:"https://shop.test/jacket",imageUrl:"https://shop.test/jacket.jpg"};
  const api = createIntegrationHandlers(pool,async()=>{fetches++;return {item:product,images:[product.imageUrl],priceQuote:{price:"99",currency:"USD",source_url:product.purchaseUrl,fetched_at:Date.now()}};});
  try {
    for (const id of [owner,other]) await pool.query('insert into "user" (id,name,email) values ($1,$1,$2)',[id,`${id}@example.test`]);
    const token = await createIntegrationToken(pool,owner,"Instinct",["items:read","wishlist:write","wardrobe:write"]);
    const raw = (await pool.query("select * from capsule_integration_tokens where id=$1",[token.id])).rows[0];
    assert.equal(raw.token_hash,digest(token.token)); assert.equal(JSON.stringify(raw).includes(token.token),false);
    const write = (kind:"wishlist"|"wardrobe"|"purchase",body:unknown,key:string,id?:string,secret=token.token)=>api.write(new Request("https://capsule.test/api/v1",{method:"POST",headers:{...headers,authorization:`Bearer ${secret}`,"idempotency-key":key},body:JSON.stringify(body)}),kind,id);
    const request = {url:product.purchaseUrl,size:"M"};
    const responses = await Promise.all(Array.from({length:6},()=>write("wishlist",request,"same-key-123")));
    const bodies = await Promise.all(responses.map(r=>r.json()));
    assert.ok(responses.every(r=>r.status===200)); assert.ok(bodies.every(b=>b.id===bodies[0].id));
    const id=bodies[0].id, revision=bodies[0].sync.revision;
    assert.equal((await pool.query("select count(*)::int as n from capsule_records where user_id=$1",[owner])).rows[0].n,1);
    const previousFetches=fetches;
    assert.equal((await write("wishlist",request,"same-key-123")).headers.get("Idempotency-Replayed"),"true"); assert.equal(fetches,previousFetches);
    assert.equal((await write("wishlist",{...request,size:"L"},"same-key-123")).status,409);
    assert.equal((await write("wishlist",request,"new-key-456")).status,200);
    assert.equal((await (await write("wishlist",request,"new-key-456")).json()).duplicate,true);
    const source=(await pool.query("select record from capsule_records where user_id=$1 and id=$2",[owner,id])).rows[0].record;
    assert.equal(source.priceHistory[0].price,99);
    validateSyncRequest({expectedUserId:owner,cursor:0,changes:[{collection:"wishlist",record:source,baseRevision:0,token:crypto.randomUUID()}]});
    assert.equal((await write("purchase",{expectedRevision:revision+1},"stale-purchase",id)).status,409);
    const purchased=await (await write("purchase",{expectedRevision:revision,size:"M",price:"89"},"purchase-123",id)).json();
    assert.equal(purchased.id,id);assert.equal(purchased.collection,"wardrobe");assert.equal(purchased.sync.devices,"pending");
    const rows=(await pool.query("select collection,record,revision from capsule_records where user_id=$1 order by revision",[owner])).rows;
    assert.equal(rows.length,2); assert.ok(rows.find(row=>row.collection==="wishlist").record.deletedAt);
    const owned=rows.find(row=>row.collection==="items"); assert.equal(owned.record.price,"89"); assert.equal(owned.record.imageUrl,product.imageUrl);
    assert.equal("priceHistory" in owned.record,false);
    validateSyncRequest({expectedUserId:owner,cursor:0,changes:[{collection:"items",record:owned.record,baseRevision:0,token:crypto.randomUUID()}]});
    assert.deepEqual(await (await write("purchase",{expectedRevision:revision,size:"M",price:"89"},"purchase-123",id)).json(),purchased);
    assert.equal((await write("purchase",{},"new-purchase",id)).status,404);
    const lookup=(secret:string,query="")=>api.lookup(new Request(`https://capsule.test/api/v1/items${query}`,{headers:{authorization:`Bearer ${secret}`}}));
    assert.equal((await (await lookup(token.token,`?url=${encodeURIComponent(product.purchaseUrl+"?utm_source=bot")}`)).json()).items.length,1);
    const otherToken=await createIntegrationToken(pool,other,"Other",["items:read","wardrobe:write","wishlist:write"]);
    assert.deepEqual((await (await lookup(otherToken.token,`?id=${id}`)).json()).items,[]);
    assert.equal((await write("purchase",{},"other-purchase",id,otherToken.token)).status,404);
    const limited=await createIntegrationToken(pool,owner,"Wishlist only",["wishlist:write"]);
    assert.equal((await lookup(limited.token)).status,403);
    assert.equal((await write("wardrobe",{name:"Shirt",fetch:false},"no-permission",undefined,limited.token)).status,403);
    assert.equal((await write("purchase",{},"limited-move",id,limited.token)).status,403);
    assert.equal((await write("wardrobe",{name:"Shirt",fetch:false,imageUrl:"javascript:alert(1)"},"bad-image-url")).status,400);
    assert.equal((await write("wardrobe",{name:"Shirt",fetch:false},"missing")).status,400);
    const manual=await (await write("wardrobe",{name:"Thrifted shirt",category:"tops",fetch:false},"direct-wardrobe")).json();assert.ok(manual.id);
    // Managing credentials requires the browser session, origin, and expected account.
    const manage=createIntegrationTokenHandlers(pool,async()=>owner);
    assert.equal((await manage(new Request("https://capsule.test/api/integrations/tokens",{method:"POST",headers:{...headers,origin:"https://evil.test"},body:JSON.stringify({expectedUserId:owner,name:"bad",scopes:["items:read"]})}))).status,403);
    assert.equal((await manage(new Request(`https://capsule.test/api/integrations/tokens?expectedUserId=${other}`))).status,409);
    const listed=await (await manage(new Request(`https://capsule.test/api/integrations/tokens?expectedUserId=${owner}`))).json();
    assert.equal(JSON.stringify(listed).includes(raw.token_hash),false);assert.equal(JSON.stringify(listed).includes(token.token),false);
    await manage(new Request("https://capsule.test/api/integrations/tokens",{method:"DELETE",headers,body:JSON.stringify({expectedUserId:owner,id:token.id})}));
    assert.equal((await write("wishlist",request,"same-key-123")).status,401); // Even replays require an active token.
    await pool.query("update capsule_integration_tokens set expires_at=now()-interval '1 second' where id=$1",[limited.id]);
    await assert.rejects(authenticateToken(pool,digest(limited.token),["wishlist:write"]));
    await pool.query('delete from "user" where id=$1',[owner]);
    assert.equal((await pool.query("select count(*)::int n from capsule_integration_tokens where user_id=$1",[owner])).rows[0].n,0);
    assert.equal((await pool.query("select count(*)::int n from capsule_integration_receipts where user_id=$1",[owner])).rows[0].n,0);
  } finally {await pool.query('delete from "user" where id=any($1)',[[owner,other]]);await pool.end();}
});

test("revocation during product extraction prevents the later write; failed extraction is retryable",{skip:!database},async()=>{
  const pool=new Pool({connectionString:database});const owner=crypto.randomUUID();
  try {
    await pool.query('insert into "user"(id,name,email) values ($1,$1,$2)',[owner,`${owner}@example.test`]);
    const token=await createIntegrationToken(pool,owner,"Test",["wishlist:write"]);
    const request=()=>new Request("https://capsule.test/api/v1/wishlist",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token.token}`,"idempotency-key":"retryable-fetch"},body:JSON.stringify({url:"https://shop.test/piece"})});
    const failed=createIntegrationHandlers(pool,async()=>{throw new Error("Unavailable");});
    assert.equal((await failed.write(request(),"wishlist")).status,502);
    assert.equal((await pool.query("select count(*)::int n from capsule_integration_receipts where user_id=$1",[owner])).rows[0].n,0);
    const api=createIntegrationHandlers(pool,async()=>{
      await pool.query("update capsule_integration_tokens set revoked_at=now() where id=$1",[token.id]);
      return {item:{name:"Piece",brand:"",size:"",color:"",category:"tops",price:"",currency:"",description:"",purchaseUrl:"https://shop.test/piece",imageUrl:""},images:[]};
    });
    assert.equal((await api.write(request(),"wishlist")).status,401);
    assert.equal((await pool.query("select count(*)::int n from capsule_records where user_id=$1",[owner])).rows[0].n,0);
  } finally {await pool.query('delete from "user" where id=$1',[owner]);await pool.end();}
});
