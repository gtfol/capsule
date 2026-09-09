# capsule

A personal wardrobe. Import clothes from product links, keep a visual inventory, and render selected pieces on your reference photo. No advice, ratings, or recommendations.

## Run

Node 22.13+ or 24 LTS and npm.

```sh
npm install
npm run dev
```

Open http://localhost:3000. The wardrobe starts empty. No account or environment variables are required.

Next.js 16, React 19, Tailwind 4, shadcn/ui (Radix primitives), Zustand, native IndexedDB, Lucide. The architecture follows [Freewrite](https://github.com/gtfol/freewrite). The Next.js version includes security fixes released after Freewrite's referenced version.

## Product links and local storage

Paste a product URL under Add, review its extracted name, brand, price, description and photos, choose a category, and save. Items have editable size, color, and purchase link. Product photos are copied into IndexedDB as compressed JPEGs. No garment upload or sample inventory is included.

Import reads JSON-LD Product/ProductGroup data, OpenGraph, product galleries and public Shopify metadata. Product pages that block automated access or expose no product image return an error; the app does not fabricate an item. Images favor explicitly labeled packshots when available, with alternate images available for selection. It does not remove image backgrounds.

Saved pieces, outfit images, edits and deletions work offline. A production service worker caches the app shell and assets after the first visit; dev mode does not register it. Fetching a new product page and rendering a new outfit require the internet. Browser storage is device-specific and can be removed by clearing site data.

## Optional sync setup

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

Tests cover metadata extraction, public-host validation and DNS pinning, redirect and decompression limits, offline writes and tombstones, sync conflicts and account isolation, offline reconnection, request validation, rendering credentials and mocked image-service responses.
