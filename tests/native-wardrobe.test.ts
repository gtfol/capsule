import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createIntegrationHandlers } from "../src/lib/server/integration-api";
import { createIntegrationToken, type IntegrationScope } from "../src/lib/server/integration-tokens";
import { createIntegrationTokenHandlers } from "../src/lib/server/integration-token-api";

const database = process.env.TEST_INTEGRATION_DATABASE_URL;
test("native wardrobe: photo access, account isolation, deletion grants, revisions and replay", {skip: !database}, async () => {
  const url = new URL(database!); assert.equal(url.hostname,"127.0.0.1"); assert.equal(url.pathname,"/capsule_integrations_test");
  const pool = new Pool({connectionString:database});
  const owner=randomUUID(), other=randomUUID();
  const api=createIntegrationHandlers(pool);
  try {
    for (const id of [owner,other]) await pool.query('insert into "user" (id,name,email) values ($1,$1,$2)',[id,`${id}@example.test`]);
    const grants:IntegrationScope[]=["items:read","wardrobe:write","wardrobe:delete"];
    const app=await createIntegrationToken(pool,owner,"capsule scan",grants);
    const agent=await createIntegrationToken(pool,owner,"agent",["items:read","wardrobe:write"]);
    const stranger=await createIntegrationToken(pool,other,"capsule scan",grants);
    const request=(token:string,method="GET",body?:unknown,key=randomUUID())=>new Request("https://capsule.test/api/v1/wardrobe",{method,headers:{authorization:`Bearer ${token}`,"Content-Type":"application/json","Idempotency-Key":key},...(body ? {body:JSON.stringify(body)} : {})});
    const {default:sharp}=await import("sharp");
    const pixels=await sharp({create:{width:20,height:10,channels:3,background:"white"}}).png().toBuffer();
    const created=await (await api.write(request(app.token,"POST",{name:"shirt",fetch:false,description:"cotton",imageData:`data:image/png;base64,${pixels.toString("base64")}`}),"wardrobe")).json();
    assert.ok(created.id);
    const detail=await api.wardrobeItem(request(app.token),created.id);
    assert.equal(detail.status,200);
    const item=(await detail.json()).item;
    assert.equal(item.description,"cotton"); assert.ok(item.createdAt); assert.equal(item.photos.front,true);
    assert.equal("imageData" in item,false);
    const photo=await api.wardrobeItem(request(app.token),created.id,"front");
    assert.equal(photo.status,200); assert.equal(photo.headers.get("Content-Type"),"image/webp"); assert.equal(photo.headers.get("Cache-Control"),"private, no-store");
    assert.ok((await photo.arrayBuffer()).byteLength>0);
    assert.equal((await api.wardrobeItem(request(stranger.token),created.id,"front")).status,404);
    assert.equal((await api.wardrobeItem(request(app.token),created.id,"side")).status,404);
    assert.equal((await api.write(request(agent.token,"DELETE",{expectedRevision:item.revision}),"delete-wardrobe",created.id)).status,403);
    assert.equal((await api.write(request(stranger.token,"DELETE",{expectedRevision:item.revision}),"delete-wardrobe",created.id)).status,404);
    assert.equal((await api.write(request(app.token,"DELETE",{expectedRevision:item.revision+1}),"delete-wardrobe",created.id)).status,409);
    assert.equal((await api.write(request(app.token,"DELETE",{}),"delete-wardrobe",created.id)).status,400);
    const key=randomUUID(), body={expectedRevision:item.revision};
    const results=await Promise.all([api.write(request(app.token,"DELETE",body,key),"delete-wardrobe",created.id),api.write(request(app.token,"DELETE",body,key),"delete-wardrobe",created.id)]);
    assert.ok(results.every(r=>r.status===200));
    assert.deepEqual(await results[0].json(),await results[1].json());
    const record=(await pool.query("select record,revision from capsule_records where user_id=$1 and id=$2",[owner,created.id])).rows[0];
    assert.ok(record.record.deletedAt); assert.ok(Number(record.revision)>item.revision);
    assert.equal((await api.wardrobeItem(request(app.token),created.id,"front")).status,404);
    assert.equal((await api.write(request(app.token,"PATCH",{expectedRevision:record.revision,name:"restore"}),"update-wardrobe",created.id)).status,400); // API requires a numeric revision.
    assert.equal((await api.write(request(app.token,"PATCH",{expectedRevision:Number(record.revision),name:"restore"}),"update-wardrobe",created.id)).status,404);
    const manager=createIntegrationTokenHandlers(pool,async()=>owner);
    assert.equal((await manager(new Request("https://capsule.test/api/integrations/tokens",{method:"POST",headers:{origin:"https://capsule.test","content-type":"application/json"},body:JSON.stringify({expectedUserId:owner,name:"agent",scopes:grants})}))).status,400);
  } finally { await pool.query('delete from "user" where id=any($1)',[[owner,other]]); await pool.end(); }
});
