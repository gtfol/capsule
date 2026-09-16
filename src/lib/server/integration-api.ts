import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { integrationCreateSchema as createSchema, integrationUpdateSchema as updateSchema, integrationPurchaseSchema as purchaseSchema } from "../integration-input";
import { type Item, type WishlistItem } from "../types";
import { findDuplicatePiece, productLinkKey } from "../piece-identity";
import { createWishlistItem, normalizeListingUrl, recomputeWishlistPrice } from "../wishlist";
import { MAX_ITEM_IMAGE_CHARS } from "../image-limits";
import { PHOTO_FIELDS, prepareIntegrationPhotos } from "./integration-photos";
import { importProduct, type ProductImport } from "./product";
import { MAX_SYNC_BYTES, validateSyncRequest } from "./sync-validation";
import { readLimitedJson } from "./render";
import { createDatabaseLimiter } from "./request-limit";
import { authenticateToken, bearerHash, digest, IntegrationError, integrationFailure, type IntegrationScope } from "./integration-tokens";

type CreateInput = z.infer<typeof createSchema>;
type PurchaseInput = z.infer<typeof purchaseSchema>;
type UpdateInput = z.infer<typeof updateSchema>;
type Row = { collection: "items" | "wishlist"; record: Item | WishlistItem; revision: string };
type MutationResult = { id: string; collection: "wardrobe" | "wishlist"; duplicate: boolean; movedFrom?: string; sync: { status: "saved_to_cloud"; revision: number; devices: "pending" } };
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
const uuid = (value: string) => z.uuid().safeParse(value).success;
const reply = (body: unknown, headers?: Record<string,string>) => Response.json(body, {headers: {"Cache-Control":"no-store", ...headers}});
const summary = (row: Row) => ({ id: row.record.id, collection: row.collection === "items" ? "wardrobe" : "wishlist", revision: Number(row.revision), name: row.record.name, brand: row.record.brand, size: row.record.size, color: row.record.color, category: row.record.category, url: row.record.purchaseUrl, imageUrl: row.record.imageUrl, backImageUrl: row.record.backImageUrl ?? "", sideImageUrl: row.record.sideImageUrl ?? "", photos: {front:!!(row.record.imageUrl || row.record.imageData),back:!!(row.record.backImageUrl || row.record.backImageData),side:!!(row.record.sideImageUrl || row.record.sideImageData)}, price: row.record.price, currency: row.record.currency });
// Lookup and deduplication do not load embedded photos or full price histories.
const metadata = `jsonb_build_object('id',id,'name',record->'name','brand',record->'brand','category',record->'category','size',record->'size','color',record->'color','purchaseUrl',record->'purchaseUrl','sourceKey',record->'sourceKey','sources',record->'sources','imageUrl',record->'imageUrl','backImageUrl',record->'backImageUrl','sideImageUrl',record->'sideImageUrl','imageData',case when coalesce(record->>'imageData','')<>'' then 'present' else '' end,'backImageData',case when coalesce(record->>'backImageData','')<>'' then 'present' else '' end,'sideImageData',case when coalesce(record->>'sideImageData','')<>'' then 'present' else '' end,'price',record->'price','currency',record->'currency') as record`;

async function existingPieces(client: PoolClient, userId: string, collection: string): Promise<Row[]> {
  return (await client.query<Row>(`select collection, ${metadata}, revision from capsule_records where user_id=$1 and collection=$2 and coalesce((record->>'deletedAt')::bigint,0)=0`, [userId, collection])).rows;
}
function validateRecord(userId: string, collection: "items" | "wishlist", record: Item): Item | WishlistItem {
  try { return validateSyncRequest({expectedUserId:userId, cursor:0, changes:[{collection,record,baseRevision:0,token:randomUUID()}]}).changes[0].record as Item | WishlistItem; }
  catch { throw new IntegrationError("The item details are invalid or too large."); }
}
async function insertItem(client: PoolClient, userId: string, collection: string, item: Item) {
  const result = await client.query<{revision: string}>("insert into capsule_records (user_id,collection,id,record) values ($1,$2,$3,$4::jsonb) returning revision", [userId,collection,item.id,JSON.stringify(item)]);
  return Number(result.rows[0].revision);
}
function result(id: string, collection: "items" | "wishlist", revision: number, duplicate: boolean): MutationResult {
  return {id,collection:collection === "items" ? "wardrobe" : "wishlist",duplicate,sync:{status:"saved_to_cloud",revision,devices:"pending"}};
}

export function createIntegrationHandlers(pool: Pool, extract: (url: string) => Promise<ProductImport> = importProduct) {
  const limit = createDatabaseLimiter((sql,values) => pool.query(sql,values));
  async function rate(userId: string, write: boolean) {
    const allowed = await limit(digest(`capsule:integration:${userId}:${write ? "write" : "read"}`), write ? {count:60,seconds:600} : {count:120,seconds:60});
    if (!allowed.allowed) throw new IntegrationError(`Too many requests. Retry in ${allowed.retryAfter} seconds.`,429,"RATE_LIMITED");
  }
  async function locked<T>(hash: string, userId: string, scopes: IntegrationScope[], operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '5s'");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`capsule:${userId}`]);
      const token = await authenticateToken(client,hash,scopes,true);
      if (token.user_id !== userId) throw new IntegrationError("Invalid integration token.",401,"UNAUTHORIZED");
      const value = await operation(client);
      await client.query("update capsule_integration_tokens set last_used_at=now() where id=$1", [token.id]);
      await client.query("commit");
      return value;
    } catch(error) { await client.query("rollback").catch(() => {}); throw error; }
    finally { client.release(); }
  }
  return {
    async lookup(request: Request) {
      try {
        const hash = bearerHash(request), scopes: IntegrationScope[] = ["items:read"];
        const token = await authenticateToken(pool,hash,scopes);
        await rate(token.user_id,false);
        const query = new URL(request.url).searchParams;
        if ([...query.keys()].some(key => !["id","url","collection","cursor"].includes(key))) throw new IntegrationError("Unknown lookup parameter.");
        const id = query.get("id"), url = query.get("url"), collection = query.get("collection");
        const cursor = Number(query.get("cursor") ?? 0);
        if ((id && !uuid(id)) || (url && !productLinkKey(url)) || !Number.isSafeInteger(cursor) || cursor < 0 || (collection && !["wardrobe","wishlist"].includes(collection))) throw new IntegrationError("Invalid lookup parameters.");
        return await locked(hash,token.user_id,scopes,async client => {
          const rows = (await client.query<Row>(`select collection,${metadata},revision from capsule_records where user_id=$1 and collection in ('items','wishlist') and coalesce((record->>'deletedAt')::bigint,0)=0 and revision>$2 and ($3::uuid is null or id=$3) and ($4::text is null or collection=$4) order by revision limit 101`, [token.user_id,cursor,id,collection === "wardrobe" ? "items" : collection])).rows;
          const page = rows.slice(0,100), key = url ? productLinkKey(url) : null;
          const matches = page.filter(row => !key || [row.record.purchaseUrl,...("sources" in row.record && row.record.sources ? row.record.sources.map(s=>s.url) : [])].some(source => productLinkKey(source) === key));
          return reply({items:matches.map(summary),cursor:page.length ? Number(page.at(-1)!.revision) : cursor,hasMore:rows.length>100,sync:{status:"cloud_snapshot"}});
        });
      } catch(error) { return integrationFailure(error); }
    },
    async write(request: Request, kind: "wishlist" | "wardrobe" | "purchase" | "update-wishlist" | "update-wardrobe", id?: string) {
      try {
        const hash = bearerHash(request);
        const scopes: IntegrationScope[] = kind === "purchase" ? ["wishlist:write","wardrobe:write"] : [(kind === "wishlist" || kind === "update-wishlist") ? "wishlist:write" : "wardrobe:write"];
        const token = await authenticateToken(pool,hash,scopes);
        await rate(token.user_id,true);
        const key = request.headers.get("idempotency-key") ?? "";
        if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) throw new IntegrationError("Send an Idempotency-Key of 8–200 letters, digits, dots, colons, underscores or hyphens.",400,"IDEMPOTENCY_KEY_REQUIRED");
        if (!request.headers.get("content-type")?.includes("application/json")) throw new IntegrationError("Send a JSON request.",415);
        const updating = kind === "update-wishlist" || kind === "update-wardrobe";
        if ((kind === "purchase" || updating) && (!id || !uuid(id))) throw new IntegrationError("Invalid item ID.");
        let parsed: CreateInput | PurchaseInput | UpdateInput;
        try { const raw = await readLimitedJson(request.body,MAX_SYNC_BYTES); parsed = kind === "purchase" ? purchaseSchema.parse(raw) : updating ? updateSchema.parse(raw) : createSchema.parse(raw); }
        catch { throw new IntegrationError("Invalid or oversized request body. Check the integration documentation."); }
        const requestHash = digest(canonical({kind,id:id ?? null,body:parsed}));
        let imported: ProductImport | undefined;
        let photos: Partial<Item> | undefined;
        const perform = () => locked(hash,token.user_id,scopes,async client => {
          const saved = await client.query<{request_hash:string;response:MutationResult}>("select request_hash,response from capsule_integration_receipts where user_id=$1 and key=$2",[token.user_id,key]);
          if (saved.rows[0]) {
            if (saved.rows[0].request_hash !== requestHash) throw new IntegrationError("This idempotency key was already used for another request.",409,"IDEMPOTENCY_CONFLICT");
            return reply(saved.rows[0].response,{"Idempotency-Replayed":"true"});
          }
          let response: MutationResult;
          if (kind === "purchase") {
            const input = parsed as PurchaseInput;
            const source = (await client.query<Row>("select collection,record,revision from capsule_records where user_id=$1 and collection='wishlist' and id=$2",[token.user_id,id])).rows[0];
            if (!source || source.record.deletedAt) throw new IntegrationError("This wishlist item is missing or already removed. Look up the wardrobe item before retrying with a new key.",404,"NOT_FOUND");
            if (input.expectedRevision !== undefined && input.expectedRevision !== Number(source.revision)) throw new IntegrationError("This wishlist item changed. Look it up again before moving it.",409,"REVISION_CONFLICT");
            const {rating:_rating,sources:_sources,priceHistory:_history,currentSourceUrl:_current,link_broken:_broken,...base} = source.record as WishlistItem;
            void _rating; void _sources; void _history; void _current; void _broken;
            const {expectedRevision:_expected,...updates} = input; void _expected;
            const now = Date.now();
            const item = validateRecord(token.user_id,"items",{...base,...updates,updatedAt:now});
            const candidates = await existingPieces(client,token.user_id,"items");
            const duplicate = candidates.find(row=>row.record.id===item.id) ?? candidates.find(row=>row.record.id===findDuplicatePiece(item,candidates.map(r=>r.record))?.id);
            // A deleted wardrobe row with this ID must never be resurrected.
            const occupied = (await client.query("select 1 from capsule_records where user_id=$1 and collection='items' and id=$2",[token.user_id,item.id])).rowCount;
            if (!duplicate && occupied) throw new IntegrationError("This piece was previously removed from your wardrobe. Add it explicitly with a new item ID.",409,"ITEM_REMOVED");
            const revision = duplicate ? Number(duplicate.revision) : await insertItem(client,token.user_id,"items",item);
            const tombstone = {...source.record,deletedAt:now,updatedAt:now};
            const moved = await client.query<{revision:string}>("update capsule_records set record=$3::jsonb,revision=nextval('capsule_sync_revision') where user_id=$1 and collection='wishlist' and id=$2 returning revision",[token.user_id,id,JSON.stringify(tombstone)]);
            response = {...result(duplicate?.record.id ?? item.id,"items",Math.max(revision,Number(moved.rows[0].revision)),!!duplicate),movedFrom:id};
          } else if (updating) {
            const input = parsed as UpdateInput;
            const collection = kind === "update-wishlist" ? "wishlist" : "items";
            const source = (await client.query<Row>("select collection,record,revision from capsule_records where user_id=$1 and collection=$2 and id=$3",[token.user_id,collection,id])).rows[0];
            if (!source || source.record.deletedAt) throw new IntegrationError("This piece is missing or removed.",404,"NOT_FOUND");
            if (input.expectedRevision !== Number(source.revision)) throw new IntegrationError("This piece changed. Look it up again before editing it.",409,"REVISION_CONFLICT");
            if (!photos) return null;
            const {expectedRevision:_expected,url,...fields} = input; void _expected;
            let item: Item | WishlistItem = {...source.record,...fields,...photos,...(url !== undefined ? {purchaseUrl:url} : {}),updatedAt:Date.now()};
            if (collection === "wishlist") {
              const wishlist = item as WishlistItem;
              const purchaseUrl = wishlist.purchaseUrl ? normalizeListingUrl(wishlist.purchaseUrl) : "";
              let sources = wishlist.sources;
              if (purchaseUrl && !sources.some(source => source.url === purchaseUrl)) {
                sources = [...sources,{url:purchaseUrl,price:input.price ?? "",currency:input.currency ?? wishlist.currency,fetched_at:null,link_broken:false}];
              } else if (purchaseUrl && (input.price !== undefined || input.currency !== undefined)) {
                sources = sources.map(source => source.url === purchaseUrl ? {...source,...(input.price !== undefined ? {price:input.price} : {}),...(input.currency !== undefined ? {currency:input.currency} : {})} : source);
              }
              item = recomputeWishlistPrice({...wishlist,purchaseUrl,sources});
            }
            const record = validateRecord(token.user_id,collection,item);
            const updated = await client.query<{revision:string}>("update capsule_records set record=$4::jsonb,revision=nextval('capsule_sync_revision') where user_id=$1 and collection=$2 and id=$3 returning revision",[token.user_id,collection,id,JSON.stringify(record)]);
            response = result(record.id,collection,Number(updated.rows[0].revision),false);
          } else {
            const input = parsed as CreateInput;
            if (!photos || (input.fetch && input.url && !imported)) return null; // Fetch outside the account lock.
            const {url,fetch:_fetch,...fields} = input; void _fetch;
            const now = Date.now();
            const item: Item = {id:randomUUID(),name:"",brand:"",size:"",color:"",category:"tops",price:"",currency:"",description:"",purchaseUrl:url ?? "",imageUrl:"",...imported?.item,...fields,...photos,createdAt:now,updatedAt:now,deletedAt:null};
            const collection = kind === "wishlist" ? "wishlist" : "items";
            const record = validateRecord(token.user_id,collection,collection === "wishlist" ? createWishlistItem(item,now,imported?.priceQuote) : item);
            const candidates = await existingPieces(client,token.user_id,collection);
            const match = findDuplicatePiece(record,candidates.map(row=>row.record));
            const duplicate = candidates.find(row=>row.record.id === match?.id);
            const revision = duplicate ? Number(duplicate.revision) : await insertItem(client,token.user_id,collection,record);
            response = result(duplicate?.record.id ?? record.id,collection,revision,!!duplicate);
          }
          await client.query("insert into capsule_integration_receipts (user_id,key,request_hash,response) values ($1,$2,$3,$4::jsonb)",[token.user_id,key,requestHash,JSON.stringify(response)]);
          return reply(response,{"Idempotency-Replayed":"false"});
        });
        const initial = await perform();
        if (initial) return initial;
        if (kind !== "purchase") {
          const input = parsed as CreateInput | UpdateInput;
          if (PHOTO_FIELDS.reduce((size,[,data])=>size+(input[data]?.length ?? 0),0) > MAX_ITEM_IMAGE_CHARS) throw new IntegrationError("The combined uploaded photos are too large.");
          photos = await prepareIntegrationPhotos(input);
          if (!updating && (input as CreateInput).fetch && input.url) {
            try { imported = await extract(input.url); }
            catch { throw new IntegrationError("This product page could not be fetched. Retry with the same key, or send item details with fetch:false and a new key.",502,"IMPORT_FAILED"); }
          }
        }
        return (await perform())!;
      } catch(error) { return integrationFailure(error); }
    },
  };
}
