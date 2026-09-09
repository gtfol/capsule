# capsule

A personal wardrobe and wishlist. Add clothes from product links or your own photos, keep a visual inventory, and render owned pieces on your saved model photo. No advice or recommendations. Wishlist ratings are set only by you.

Navigation uses nuqs: Wardrobe is `/`, and Wishlist, Add, and Outfits use `?view=wishlist`, `?view=add`, and `?view=outfits`. Add's wishlist destination is kept in `to=wishlist`. Refresh and browser Back/Forward restore the view; navigating between views keeps open editor drafts until the account changes or the page reloads.

## Run

Node 22.13+ or 24 LTS and npm.

```sh
npm install
npm run dev
```

Open http://localhost:3000. The wardrobe starts empty. No account or environment variables are required.

Next.js 16, React 19, Tailwind 4, shadcn/ui (Radix primitives), Zustand, native IndexedDB, Lucide. The architecture follows [Freewrite](https://github.com/gtfol/freewrite). The Next.js version includes security fixes released after Freewrite's referenced version.

## Product links and local storage

Paste a product URL under Add, review its extracted name, brand, price, description and photos, choose a category, and save. Or select Photos and choose or drop up to three JPG, PNG, WebP or AVIF images, up to 20 MB each. Add a name and any other details; purchase links are optional. Images are compressed and saved in IndexedDB. The wardrobe starts empty.

Select a front image and optional back and side images from the imported gallery or your uploaded photos. Card hover pairs follow Front/Back, Side/Back, then Front/Side, based on the distinct photos available; the detail panel lets you switch views on touch devices. All selected views are saved locally and included in optional sync, with automatic compression to keep each piece within the sync size limit. When editing a saved piece, the photo toolbar can add uploads or fetch the gallery from its purchase link without replacing its details or selected photos. Existing pieces with one image continue to work.

Import reads JSON-LD Product/ProductGroup data, OpenGraph, product galleries and public Shopify metadata. Product pages that block automated access or expose no product image return an error; the app does not fabricate an item. Images favor explicitly labeled packshots when available, with alternate images available for selection.

The Remove background icon processes the selected photo on this device in a dedicated worker using Transformers.js and BiRefNet Lite. Its first use downloads the pinned model (about 99 MB on supported WebGPU devices, or 192 MB for the WebAssembly fallback), plus runtime assets. Browser caches allow reuse without downloading again while those caches remain available. Photos are never sent to the model host. Compare the original with the transparent cutout before accepting it; cancel or keep the original at any time. Processing requires a browser with workers and OffscreenCanvas, and may be slow on devices without a supported GPU. It removes the background; it does not reconstruct fabric hidden by other objects. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for licenses.

Saved pieces, outfit images, edits and deletions work offline. A production service worker caches the app shell and assets after the first visit; dev mode does not register it. Fetching a new product page and rendering a new outfit require the internet. Browser storage is device-specific and can be removed by clearing site data.

The sun/moon icon in the bottom bar switches between light and dark, matching Freewrite. Capsule follows the device setting until you choose a theme, then remembers that choice in this browser. Closing an edited piece with X, Escape or an outside click opens a restrained Save changes / Discard changes / Keep editing dialog. Background-removal setup says “Preparing background removal…” before processing. Transparent cutouts use a plain white or black surface to match the theme, including the preview and wardrobe grid.

## Wishlist

The Wishlist tab is a separate local collection. In Add, choose Wishlist and paste a product link, then review its photo, name, brand, details and price. The first available current-price quote is recorded with its source URL, currency and fetch time. Pages without a reliable price can still be saved; manually entering a price does not fabricate a historical fetch.

Set your own rating from half a star to five stars. Select the same rating again to clear it; arrow keys move in half steps, and Delete or Backspace clears the rating. Cards display the current price, rating and an unavailable-link icon after a failed check. Filter by category and sort by recently added, highest rated or biggest percentage price drop from the first recorded comparable price.

In the detail panel, Refetch price checks the current product link. Add alternative link fetches another listing for the same piece; each listing can be checked individually. Every successful check appends an observation to the same history. The interactive dot chart shows each observation, with a compact price/date/source readout on hover, tap or keyboard selection. Overlapping observations can be cycled and source markers distinguish listing URLs; a table exposes the full history. Currencies are displayed separately; the current price is the lowest healthy source in the piece's comparison currency. There is no currency conversion. Failed listings keep their previous history and are excluded from the current minimum until a successful check; if all sources fail, the last known price remains visible.

Once purchased, Move to wardrobe transfers the piece, including its current edits and photos, in one IndexedDB transaction. The wishlist entry is removed and both changes enter the optional sync queue. Wishlist pieces are never available in the outfit picker until moved. There are no automatic or scheduled price fetches. A piece can hold 20 source links and 1,000 price observations, subject to the sync payload limit; history is never silently truncated.

Wishlist records, ratings, history, source status and photos use the existing account-isolated local storage and optional sync. Local metadata saves merge with the latest price records so an open editor does not overwrite another tab's new observations.

## Sharing

Use Share in the bottom navigation to share a wardrobe or wishlist, or the small share icon in a piece or saved outfit's controls. Links default to seven days; choose 30 days or Never. Changing expiration preserves the published snapshot. Update link explicitly publishes the latest saved details and photos while preserving the existing deadline. Anyone with the link can view it without an account.

Collection links include up to 300 pieces with front photos; individual pieces include front, back and side photos when available. Outfit links include the rendered image and its selected owned pieces. Images are compressed into a self-contained snapshot; original local images are unchanged. Account information, original model photos, API keys, sync metadata, and price history are excluded. Public pages are not indexed or stored in the offline app cache.

Visitors can add a shared piece or selection to their own wardrobe or wishlist after signing in and confirming. Signing in alone never imports a selection. Copies receive new IDs and their own editable records; wishlist copies start without the owner's rating or price history. Pieces without a shopping link are supported. Copies are saved atomically in the signed-in account's browser storage and enter its normal sync queue. Retrying the same selection in that browser does not duplicate it. Removing a public link does not remove copies already saved by visitors.

Manage links is available from the collection Share popover, including links to pieces or outfits that have since been deleted. Link management belongs to the browser and wardrobe/account space where the link was created; it does not sync between devices. Keep that browser's site data to retain control of Never links. Remove link immediately revokes future access. Ownership tokens are reserved locally before publication and only their hashes are stored on the server, so interrupted requests can be retried safely.

Existing databases need [db/migrations/20260909_add_shares.sql](db/migrations/20260909_add_shares.sql). Save and run it in the Supabase SQL editor. It creates two private tables with RLS and no browser-role grants; no new environment variables or storage buckets are needed. `/api/share` reports availability. Creation is limited to ten links per IP per hour, with keyed IP digests rather than raw addresses. Expired snapshot bodies are removed in bounded batches during share requests; small expired/revoked ID tombstones prevent old requests from republishing removed links.

## Optional sync setup

Existing Capsule databases need [db/migrations/20260908_add_wishlist.sql](db/migrations/20260908_add_wishlist.sql) before deploying the Wishlist release. Run it in the Supabase SQL editor; it only allows the new collection in the existing records table and can be run again safely. No new environment variables, browser keys, or storage bucket are needed. Fresh databases use the schema below.

1. Create a separate Supabase project for Capsule.
2. Run [db/schema.sql](db/schema.sql) in the Supabase SQL editor. Better Auth uses its own user/session/account tables; Supabase Auth is not used. RLS keeps these tables out of the public Supabase data API.
3. Add these server-only variables to the Capsule Vercel project:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase session pooler Postgres connection string, port 5432 |
| `DATABASE_SSL_CA` | Optional Supabase root certificate in PEM format, if required by the database's certificate chain |
| `BETTER_AUTH_SECRET` | A unique random secret, at least 32 characters |
| `BETTER_AUTH_URL` | `https://capsule.gtfol.dev` |
| `GOOGLE_CLIENT_ID` | Google OAuth web application's client ID |
| `GOOGLE_CLIENT_SECRET` | The same application's client secret |

4. In Google OAuth, add `https://capsule.gtfol.dev` as an authorized JavaScript origin and `https://capsule.gtfol.dev/api/auth/callback/google` as an authorized redirect URI. Add the corresponding localhost URLs for local development if needed. If the consent screen is in testing, add your Google account as a test user.
5. Redeploy. `/api/sync/status` should return `enabled: true` and `providers.google: true`. The cloud popover shows Continue with Google.

`EMAIL_PASSWORD_AUTH=1` exposes the fallback email/password form. Leave it unset for Google-only sign-in. Variables are described in [.env.example](.env.example); never commit real secrets.

Remote Postgres connections verify the server's TLS certificate and hostname. If Supabase requires its own root certificate, set `DATABASE_SSL_CA` to that certificate's PEM text (actual newlines or `\n` escapes). Connection URL query options such as `sslmode=require` cannot disable verification. Only exact loopback hosts use a connection without TLS for local development.

Sync authenticates via Better Auth at `/api/auth/[...all]`. The browser queues durable changes and deletion tombstones; Postgres revisions detect concurrent updates and keep conflicting edits as separate copies. Records and cursors are isolated by account. The first sign-in copies this browser's guest wardrobe to that account once. Explicit sign-out returns to the guest wardrobe. A session expiring leaves that account's local copy usable offline until you explicitly sign out or change accounts. Reference photos stay local and never enter sync; saved rendered outfit images do sync.

## Outfit rendering

In Outfits, add a full-body, front-facing photo or mirror selfie visible from head to toe. Hover or focus the silhouette to reveal Add photo, then choose the camera, photo library, or file picker. Touch devices always show the label. The model photo is saved in IndexedDB for this browser and guest/account space, reused for future outfits, and never synced.

Guests enter an OpenAI key for the current page session. The key stays only in React memory, is lost on reload, and has no Save control. Signed-in users can explicitly Save, Change, or Remove an account key. The description appears beneath the OpenAI API key label, and entry stays visually masked without a password input or login form.

Account keys are encrypted with AES-256-GCM before being written to `capsule_render_keys`. Each write uses a fresh 12-byte nonce and authenticated data bound to the account ID. The independent `RENDER_KEY_ENCRYPTION_KEY` is a 32-byte random secret encoded as base64, configured as a sensitive production variable in Vercel. It is never stored in Supabase. Apply `db/migrations/20260909_add_render_keys.sql` before enabling this configuration on an existing database. New databases use the updated `db/schema.sql`. The table has RLS enabled, no browser policies, and no grants to Supabase's anonymous/authenticated roles.

`GET /api/render/key` returns saved-state metadata only. PUT and DELETE require the current Better Auth session, a matching expected user ID, and a same-origin request. Signed-in renders send an account-key selection rather than the key itself; the server retrieves and decrypts the authenticated account's key only for that render. No read endpoint returns it to the browser, and keys never enter wardrobe snapshots or sync. Old browser keys from the unreleased preview are deleted at app initialization, never uploaded automatically. Server errors are sanitized and credential responses are not cached.

The encryption secret must be retained for existing keys to remain usable. Do not casually replace it: to rotate without invalidating saved keys, decrypt and re-encrypt existing records in a controlled server operation using the old and new secrets. If the old secret is lost, users must replace their saved API keys. A compromised application server can still access decrypted keys; encryption protects stored database contents, not a compromised runtime.

Select 1–6 owned pieces and choose Render outfit. The photo, selected garment images, and user's key are sent only for an explicit render to OpenAI's fixed Images edit endpoint. Rendering charges apply to that user's OpenAI account; no shared deployment OpenAI key is used. The resulting image is saved in IndexedDB and can be downloaded. No text advice is requested or displayed. The active model appears beside Render outfit. `OPENAI_IMAGE_MODEL` defaults to `gpt-image-2`; `OUTFIT_RENDERING_ENABLED=false` disables new rendering. Credit, spending, usage, and temporary rate limits have distinct messages. A live paid render is not part of automated tests.

## Deployment

The public repository is [gtfol/capsule](https://github.com/gtfol/capsule). The Vercel project is `capsule` in the `gtfol` team. Build with `npm run build`; attach `capsule.gtfol.dev` under the project's Domains settings and follow Vercel's DNS instructions. Environment-variable changes require a new deployment.

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Tests cover metadata and price extraction, public-host validation and DNS pinning, redirect and decompression limits, offline writes and tombstones, sync conflicts and account isolation, offline reconnection, request validation, rendering credentials and mocked image-service responses. Wishlist tests cover currency separation, price-history ordering, source failures and recovery, local/synced ratings, concurrent updates, and atomic moves to the wardrobe including rollback.
