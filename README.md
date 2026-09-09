# capsule

A personal wardrobe and wishlist. Add clothes from product links or your own photos, keep a visual inventory, and render owned pieces on your reference photo. No advice or recommendations. Wishlist ratings are set only by you.

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

In Outfits, select 1–6 owned pieces and choose a reference photo. Enter your OpenAI API key for the current page session and select Render outfit. The key is held only in memory and sent over HTTPS to the server, which forwards it only to OpenAI's fixed Images edit endpoint. The server does not use a deployment API key, store keys, or log images. This keeps an account-free public deployment from spending a shared key. Rendering charges apply to the user's OpenAI account.

The reference photo and selected garment images are sent only for an explicit render. The resulting image is saved in IndexedDB and can be downloaded. No text advice is requested or displayed. `OPENAI_IMAGE_MODEL` defaults to `gpt-image-2`; `OUTFIT_RENDERING_ENABLED=false` disables new rendering. A live paid render is not part of automated tests.

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
