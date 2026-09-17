# capsule scan sign-in

The native iPhone companion uses capsule’s existing Better Auth login. It never asks users to copy an integration token or enter a capsule password in the app.

1. The app generates a cryptographically random PKCE verifier and state (32 bytes each), retaining both in memory. It opens `/scan/connect?code_challenge=<S256 base64url digest>&state=<state>` in `ASWebAuthenticationSession`.
2. The page offers the configured Google/email providers. A signed-in user explicitly confirms access to add items to their wardrobe. The page posts to `/api/scan/authorize` with `code_challenge`, `state`, and `expectedUserId`; same-origin, current-session, and account checks are required.
3. The server stores a two-minute code hash in the existing private Better Auth `verification` table, namespaced `capsule-scan:` and bound to the session, account, and challenge. It returns the fixed callback `dev.gtfol.capsulescan://auth/callback?code=...&state=...`. Caller-supplied redirect URLs are not accepted.
4. The app validates the callback and state and posts `{code, code_verifier}` to `/api/scan/exchange`. The server verifies S256 and the originating session, then consumes the code and issues a `wardrobe:write` integration token in one database transaction. Concurrent exchanges cannot reuse the code. Tokens never appear in URLs.
5. The response contains `{token, user: {id, name}, expiresAt}`. The app stores the token and account in one Keychain entry. Access expires after one year and remains revocable under Settings → Integrations as **capsule scan**. The existing ten-active-token limit applies.

`GET /api/scan/session` validates a bearer token and returns its account (also used to migrate older manually connected app installations). `DELETE /api/scan/session` revokes that token. Neither endpoint accepts browser cookies as authorization. The app uses the existing idempotent `/api/v1/wardrobe` API for writes.

No new environment variables, database migration, Google redirect URI, or dependency is needed. The app adds its custom callback scheme to its Info.plist; Google still returns through Better Auth’s existing HTTPS callback. Authentication routes are rate limited, uncached, and excluded from service-worker navigation fallback. The connection page disables analytics and referrer forwarding.

Tests: `tests/scan-auth.test.ts`. Set `TEST_INTEGRATION_DATABASE_URL` to a disposable local `capsule_integrations_test` database with `db/schema.sql` applied to run PKCE, replay/concurrency, session expiry, account isolation, scopes, and revocation checks. Test credentials are generated only for that database.
