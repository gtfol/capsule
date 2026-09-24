import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { createIntegrationHandlers } from "../src/lib/server/integration-api";
import { createIntegrationToken } from "../src/lib/server/integration-tokens";
import { integrationWishlistCreateSchema, integrationWishlistUpdateSchema, integrationUpdateSchema } from "../src/lib/integration-input";

const database = process.env.TEST_INTEGRATION_DATABASE_URL;
test("wishlist ratings accept half stars and clear, without extending wardrobe fields", () => {
  for (const rating of [null,0.5,3,4.5,5]) {
    assert.ok(integrationWishlistCreateSchema.safeParse({name:"shirt",fetch:false,rating}).success);
    assert.ok(integrationWishlistUpdateSchema.safeParse({expectedRevision:1,rating}).success);
  }
  for (const rating of [0,0.25,5.5,"4"]) assert.equal(integrationWishlistUpdateSchema.safeParse({expectedRevision:1,rating}).success,false);
  assert.equal(integrationUpdateSchema.safeParse({expectedRevision:1,rating:4}).success,false);
});
test("native wishlist: metadata, photos, ratings, price receipts, source preservation, moves and deletion", {skip:!database}, async () => {
  const url = new URL(database!); assert.equal(url.hostname,"127.0.0.1"); assert.equal(url.pathname,"/capsule_integrations_test");
  const {default:sharp} = await import("sharp");
  const photo = "data:image/png;base64,"+(await sharp({create:{width:4,height:4,channels:3,background:"white"}}).png().toBuffer()).toString("base64");
  const pool = new Pool({connectionString:database}); const owner = crypto.randomUUID(), other = crypto.randomUUID();
  const primary = "https://shop.test/shirt", cheaper = "https://other.test/shirt";
  let fetches = 0; let failure = false;
  const api = createIntegrationHandlers(pool,async link => {
    fetches++; if(failure) throw new Error("blocked");
    return {item:{name:"shirt",brand:"",category:"tops",size:"",color:"",price:"70",currency:"USD",description:"",purchaseUrl:link,imageUrl:""},images:[],priceQuote:{price:link===primary?"100":"70",currency:"USD",source_url:link,fetched_at:Date.now()}};
  });
  try {
    for(const id of [owner,other]) await pool.query('insert into "user"(id,name,email) values ($1,$1,$2)',[id,`${id}@example.test`]);
    const token = await createIntegrationToken(pool,owner,"native",["items:read","wardrobe:write","wishlist:write","wishlist:delete"]);
    const limited = await createIntegrationToken(pool,owner,"agent",["items:read","wishlist:write"]);
    const outsider = await createIntegrationToken(pool,other,"other",["items:read","wishlist:write","wishlist:delete"]);
    const req = (body?:unknown,key="wishlist-test-key",secret=token.token) => new Request("https://capsule.test/api/v1",{method:body===undefined?"GET":"POST",headers:{authorization:`Bearer ${secret}`,"content-type":"application/json","idempotency-key":key},...(body===undefined?{}:{body:JSON.stringify(body)})});
    type Kind = Parameters<typeof api.write>[1];
    const write = (kind:Kind,body:unknown,key:string,id?:string,secret=token.token) => api.write(req(body,key,secret),kind,id);
    const read = async(id:string) => (await (await api.wardrobeItem(req(),id,undefined,"wishlist")).json()).item;
    const createdResponse = await write("wishlist",{name:"shirt",url:primary,price:"100",currency:"USD",rating:4.5,imageData:photo,backImageData:photo,sideImageData:photo,fetch:false},"create-wishlist");
    assert.equal(createdResponse.status,200); const created = await createdResponse.json(); const id = created.id;
    let item = await read(id); assert.equal(item.rating,4.5); assert.equal(item.priceHistory.length,1);
    assert.equal((await api.wardrobeItem(req(undefined,"key",outsider.token),id,undefined,"wishlist")).status,404);
    for(const view of ["front","back","side"]) { const image = await api.wardrobeItem(req(),id,view,"wishlist"); assert.equal(image.status,200); assert.match(image.headers.get("content-type")!,/^image\//); }
    const priceBody = {expectedRevision:item.revision,url:cheaper};
    const checked = await write("wishlist-price",priceBody,"cheaper-price",id); assert.equal(checked.status,200); assert.equal((await checked.json()).priceFetched,true);
    assert.equal(fetches,1);
    const replay = await write("wishlist-price",priceBody,"cheaper-price",id); assert.equal(replay.headers.get("Idempotency-Replayed"),"true"); assert.equal(fetches,1);
    item = await read(id); assert.equal(item.price,"70"); assert.equal(item.currentSourceUrl,cheaper); assert.equal(item.priceHistory.length,2);
    assert.equal((await write("wishlist-price",priceBody,"stale-price",id)).status,409); assert.equal(fetches,1);
    const edited = await write("update-wishlist",{expectedRevision:item.revision,rating:null,name:"cotton shirt"},"edit-rating",id); assert.equal(edited.status,200);
    item = await read(id); assert.equal(item.rating,null); assert.equal(item.sources.find((s:{url:string})=>s.url===primary).price,"100"); assert.equal(item.price,"70");
    const listing = await (await api.lookup(new Request("https://capsule.test/api/v1/items?collection=wishlist",{headers:{authorization:`Bearer ${token.token}`}}))).json();
    assert.equal(listing.items[0].priceDrop,30); assert.equal(listing.items[0].priceHistory,undefined);
    failure=true;
    const failedCheck = await write("wishlist-price",{expectedRevision:item.revision,url:cheaper},"broken-link",id); assert.equal(failedCheck.status,200); assert.equal((await failedCheck.json()).priceFetched,false);
    item = await read(id); assert.equal(item.link_broken,true); assert.equal(item.priceHistory.length,2); assert.equal(item.price,"100");
    const moved = await write("purchase",{expectedRevision:item.revision},"move-piece",id); assert.equal(moved.status,200); assert.equal((await moved.json()).collection,"wardrobe");
    assert.equal((await api.wardrobeItem(req(),id,undefined,"wishlist")).status,404);
    const owned = await (await api.wardrobeItem(req(),id)).json(); assert.equal(owned.item.photos.side,true);
    const second = await (await write("wishlist",{name:"new hat",fetch:false},"create-second")).json();
    const remove = {expectedRevision:second.sync.revision};
    assert.equal((await write("delete-wishlist",remove,"cannot-delete",second.id,limited.token)).status,403);
    assert.equal((await write("delete-wishlist",remove,"other-delete",second.id,outsider.token)).status,404);
    assert.equal((await write("delete-wishlist",remove,"delete-second",second.id)).status,200);
    assert.equal((await write("delete-wishlist",remove,"delete-second",second.id)).headers.get("Idempotency-Replayed"),"true");
    assert.equal((await api.wardrobeItem(req(),second.id,undefined,"wishlist")).status,404);
  } finally { await pool.query('delete from "user" where id=any($1)',[[owner,other]]); await pool.end(); }
});
