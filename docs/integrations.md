# Capsule integrations

Base URL: `https://capsule.gtfol.dev/api/v1`

Use this REST API to add shopping finds to a wishlist, record confirmed purchases,
add owned pieces directly, and look up duplicates. It writes to the signed-in
owner's cloud library. Capsule downloads those changes through its existing sync.
Local-only guest libraries are not accessible. Instinct still needs an available
HTTP integration path; this API does not itself install or connect an Instinct app.

## Connect

1. Sign in through **Sync** in Capsule.
2. Open **Settings → Integrations → Connect an AI agent**. Name it “Instinct”.
3. Choose permissions, create the token, and copy it immediately. It is shown once.
4. Put the token in your tool's secret/credential store, not a URL, prompt, public
   configuration, repository, or browser local storage.

Send `Authorization: Bearer <token>` on every request. Tokens expire after 90 days.
Revoke them in Settings at any time. Capsule stores only their SHA-256 hashes.
Deleting the Capsule account also deletes all its integration tokens and receipts.
No account password, OpenAI key, OAuth session cookie, or Supabase key is needed.

| Permission | Allows |
| --- | --- |
| `items:read` | Read item summaries for lookup and duplicate checking |
| `wishlist:write` | Create wishlist items |
| `wardrobe:write` | Create wardrobe items |
| Both write permissions | Move a wishlist item to the wardrobe |

Tokens cannot delete pieces, render outfits, read model photos/API keys, manage
share links, or create other integration tokens. A write permission permits the
corresponding endpoint to return its resulting item ID even without read access.

## Safe retries

Every POST requires `Content-Type: application/json` and an `Idempotency-Key`:
8–200 characters from letters, digits, `.`, `_`, `:`, `-`. Generate a stable UUID
for each user-approved action; **reuse it for every retry of that action**.
A committed request replays the original response without fetching or writing
again, even after token rotation (the replacement token still needs permissions).
Keys are scoped to the account and retained until account deletion. Reusing a key
for different parsed input or another endpoint returns `409 IDEMPOTENCY_CONFLICT`.

Transient errors do not consume a key. After a timeout, retry the same request
with the same key. If you change the request body, use a new key. The
`Idempotency-Replayed` response header is `true` or `false`.

A replay is the original receipt: it does not recreate an item the user later
removed or promise the item still exists. Use lookup for its current state.

## Add to wishlist or wardrobe

`POST /wishlist` requires `wishlist:write`.
`POST /wardrobe` requires `wardrobe:write`.

```json
{
  "url": "https://shop.example/products/jacket",
  "size": "M",
  "color": "Black"
}
```

By default Capsule fetches a supplied URL using its existing public-page importer
and fills in name, brand, photo, description, category, price, and currency.
Provided fields override extracted fields. No item is saved if extraction fails.

For a page the tool has already read, a removed listing, or an offline purchase,
send `fetch: false` and a name with whatever details are known:

```json
{
  "fetch": false,
  "name": "Cotton jacket",
  "brand": "Example",
  "category": "jackets",
  "size": "M",
  "color": "Black",
  "price": "89.00",
  "currency": "USD",
  "url": "https://shop.example/products/jacket",
  "imageUrl": "https://shop.example/images/jacket-front.jpg",
  "backImageUrl": "https://shop.example/images/jacket-back.jpg"
}
```

Supported fields: `url`, `fetch`, `name`, `brand`, `description`, `category`, `size`,
`color`, `price`, `currency`, `imageUrl`, `backImageUrl`, `sideImageUrl`.
Unknown fields are rejected. Image fields accept HTTP(S) URLs, not uploaded/base64
images. `price` is a nonnegative decimal string without a currency symbol; currency
is a three-letter uppercase code or empty if unknown. Categories are `tops`,
`jackets`, `bottoms`, `accessories`, `shoes`. An unspecified category defaults to
`tops` when no product extraction supplies one. Names are required when `fetch`
is false or no URL is provided. Bodies are limited to 100 KB.

Wishlist creation records the initial price in history when available. When a
page was fetched, the historical quote is the extracted quote, even if the tool
supplies a different current price. Manually supplied initial prices are recorded
at ingestion time. Ratings start empty.

Within the destination collection, a matching product link, category, size and
color returns the existing item with `duplicate: true`. Known tracking parameters
are ignored, while product/variant parameters are preserved. Missing variants
only match other missing variants. Names are never used for fuzzy matching.
Existing records are not overwritten. URL-less items rely on the idempotency key.

## Mark a wishlist piece purchased

`POST /wishlist/{id}/purchase` requires **both write permissions**.

```json
{
  "expectedRevision": 123,
  "size": "M",
  "color": "Black",
  "price": "89.00",
  "currency": "USD"
}
```

All fields are optional; `{}` moves the existing piece as-is. Pass the revision
from lookup to reject a move if the wishlist item has since changed. Only these
purchase fields are accepted. The move preserves item details and all three
photos, creates the wardrobe record, and removes the wishlist record in one
transaction. Wishlist-only ratings, sources and price history are not transferred.

If a matching wardrobe piece already exists, that piece is retained unchanged
and the wishlist piece is removed; the response identifies the existing piece.
A removed wishlist item returns 404 for a new key. Retry with the original key to
recover the successful receipt. A previously deleted wardrobe ID is not revived.
Call this endpoint only after the user confirms a purchase; a shopping suggestion
belongs in the wishlist.

## Response and sync status

Successful writes return HTTP 200:

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "collection": "wardrobe",
  "duplicate": false,
  "movedFrom": "00000000-0000-4000-8000-000000000000",
  "sync": { "status": "saved_to_cloud", "revision": 125, "devices": "pending" }
}
```

`movedFrom` is present only for moves. `sync.revision` is the highest committed
revision of this operation (including wishlist removal), **not necessarily the
wardrobe item's own revision**. It is not a browser-sync cursor to install: devices
must pull all changes normally. `devices: pending` means device delivery is not
tracked. Open Capsule signed into the same account and sync to see the item.

## Look up items

`GET /items` requires `items:read`. Optional query parameters:

- `id`: exact item UUID
- `url`: product URL, URL-encoded; matches purchase and alternative listing URLs
- `collection`: `wardrobe` or `wishlist`; otherwise both
- `cursor`: last returned cursor, starting at 0

```text
GET /items?collection=wardrobe&url=https%3A%2F%2Fshop.example%2Fproducts%2Fjacket
```

Response: `{ "items": [...], "cursor": 125, "hasMore": false,
"sync": { "status": "cloud_snapshot" } }`. Summaries include `id`, `collection`,
`revision`, `name`, `brand`, `category`, `size`, `color`, `url`, `imageUrl`, `price`,
`currency`. Deleted items, outfits, embedded photos and history are excluded.
For URL searches, Capsule scans 100 live records per page: **continue while
`hasMore` is true, even if a page's `items` is empty**. Results are only this token's
owner's cloud data; unsynced edits on other devices may not appear yet.

## Errors and limits

Errors have `{ "error": { "code": "…", "message": "…" } }` shape.

- 400: invalid request/body/key
- 401 `UNAUTHORIZED`: missing, invalid, expired or revoked token
- 403 `INSUFFICIENT_SCOPE`: missing permission
- 404 `NOT_FOUND`: missing/deleted wishlist item
- 409: idempotency, revision, or previously removed item conflict
- 415: non-JSON write
- 429 `RATE_LIMITED`: wait before retrying
- 502 `IMPORT_FAILED`: page extraction failed; no write committed
- 503 `UNAVAILABLE`: retry with the original key and exponential backoff

Per account: 60 write requests per 10 minutes and 120 lookups per minute, shared
across its tokens. Replays count toward the limit. Up to 10 active tokens.
Integration endpoints use bearer authentication only; token management uses the
signed-in Capsule browser session and same-origin checks. MCP can later wrap
these same endpoints without changing their semantics.
