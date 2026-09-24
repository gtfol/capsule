# capsule native sign-in

The native iPhone companion uses capsule’s existing Better Auth login. It never asks users to copy an integration token or enter a capsule password in the app.

1. The app generates a cryptographically random PKCE verifier and state (32 bytes each), retaining both in memory. It opens `/scan/connect?code_challenge=<S256 base64url digest>&state=<state>&access=wishlist` in `ASWebAuthenticationSession`.
2. The page offers the configured Google/email providers. A signed-in user explicitly confirms access to view, add, edit, and delete wardrobe and wishlist pieces. Older app versions omit `access` and retain capture-only access. The page posts to `/api/scan/authorize` with `code_challenge`, `state`, and `expectedUserId`; same-origin, current-session, and account checks are required.
3. The server stores a two-minute code hash in the existing private Better Auth `verification` table, namespaced `capsule-scan:` and bound to the session, account, challenge, and approved access. It returns the fixed callback `dev.gtfol.capsulescan://auth/callback?code=...&state=...`. Caller-supplied redirect URLs are not accepted.
4. The app validates the callback and state and posts `{code, code_verifier}` to `/api/scan/exchange`. The server verifies S256 and the originating session, then consumes the code and issues an integration token with the approved scopes (`items:read`, both write scopes, and both native delete scopes for wishlist; the earlier wardrobe grant remains unchanged, and legacy capture receives only `wardrobe:write`) in one database transaction. Concurrent exchanges cannot reuse the code. Tokens never appear in URLs.
5. The response contains `{token, user: {id, name}, scopes, expiresAt}`. The app stores the token and account in one Keychain entry. Access expires after one year and remains revocable under Settings → Integrations as **capsule**. The existing ten-active-token limit applies.

`GET /api/scan/session` validates a bearer token and returns its account (also used to migrate older manually connected app installations). `DELETE /api/scan/session` revokes that token. Neither endpoint accepts browser cookies as authorization. The app uses the existing idempotent `/api/v1/wardrobe` and `/api/v1/wishlist` APIs for writes.

Apply `db/migrations/20260922_native_wardrobe.sql` before deploying native wardrobe access. It permits the native deletion scope without changing any existing token. No new environment variables, Google redirect URI, or dependency is needed. The app adds its custom callback scheme to its Info.plist; Google still returns through Better Auth’s existing HTTPS callback. Authentication routes are rate limited, uncached, and excluded from service-worker navigation fallback. The connection page disables analytics and referrer forwarding.

Tests: `tests/scan-auth.test.ts`. Set `TEST_INTEGRATION_DATABASE_URL` to a disposable local `capsule_integrations_test` database with `db/schema.sql` applied to run PKCE, replay/concurrency, session expiry, account isolation, scopes, and revocation checks. Test credentials are generated only for that database.

## Online wardrobe

The native grid uses `GET /api/v1/items?collection=wardrobe`, follows every page, and keeps results in memory. Detail reads use `GET /api/v1/wardrobe/{id}`; uploaded photos use `GET /api/v1/wardrobe/{id}/photos/{front|back|side}`. These reads require `items:read`, enforce account ownership, exclude tombstones, and never cache private responses. Public product images continue through the existing safe image proxy without a bearer token.

Edits use the existing revision-checked `PATCH /api/v1/wardrobe/{id}`. Deletion uses `DELETE` on the same path with `{expectedRevision}` and a stable `Idempotency-Key`. It requires `wardrobe:delete`, which the ordinary AI-agent token creation UI/API cannot issue. The operation writes a tombstone under the same account lock and revision sequence as browser sync, so web clients receive the removal. It cannot revive a deleted item. Replays require a currently valid token and reproduce the original receipt.

Existing capture connections ask the user to sign in again for the additional access. No automatic privilege upgrade, offline library synchronization, or background mutation queue is added.

## Online wishlist

Apply `db/migrations/20260924_native_wishlist.sql` before deploying this version. It allows native `wishlist:delete` without changing existing grants. `access=wishlist` explicitly grants `items:read`, both collection write permissions, and both native delete permissions. Prior wardrobe connections keep working and ask the user to reconnect only when opening wishlist.

Wishlist reads use `GET /api/v1/items?collection=wishlist`, `GET /api/v1/wishlist/{id}`, and `GET /api/v1/wishlist/{id}/photos/{front|back|side}`. List results include rating, current price, broken-link state, and percentage price drop. Detail includes sources and price history. All reads require `items:read` and account ownership.

`POST /api/v1/wishlist` and `PATCH /api/v1/wishlist/{id}` accept nullable half-star `rating` (0.5–5). Unchanged price/currency fields are omitted by native edits so editing a name or rating does not overwrite a listing's price with the cheapest alternative's price.

`POST /api/v1/wishlist/{id}/price` accepts `{expectedRevision, url}` and requires `wishlist:write` plus `Idempotency-Key`. It checks or adds a listing on demand through the existing safe fetcher, appends a quote on success, or marks that source broken on failure. The receipt includes `priceFetched`; replaying it does not fetch again or append twice. Fetching happens outside the account lock; scope, revision, and receipt checks run again before writing. Different currencies are never compared as raw numbers.

`DELETE /api/v1/wishlist/{id}` requires native `wishlist:delete`, `{expectedRevision}`, and `Idempotency-Key`; it writes a sync tombstone. Purchase uses the existing atomic `POST /api/v1/wishlist/{id}/purchase` with the current revision and both write scopes. The app asks for confirmation and requires saved edits first.

Regression coverage: `tests/native-wishlist.test.ts`, native `WishlistTests` and `WishlistModelTests`. No offline replication, automatic price checks, or queued edits are added.
