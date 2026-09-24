# Capsule MCP

Hosted endpoint: `https://capsule.gtfol.dev/api/mcp`

Transport: **Streamable HTTP**, stateless JSON responses. This private bridge
exposes `create_wardrobe_item` and `create_wishlist_item`. It uses the existing
REST API, then looks up the returned item ID before reporting verified success.

## Connect Instinct

The client must support a hosted MCP URL with a custom **Authorization** header.
This bridge uses a preconfigured access key; it does not implement OAuth discovery
or automatically install an Instinct integration.

1. In Capsule, sign in and open **Settings → Integrations**. Create a token with
   **Look up pieces**, **Add and edit wardrobe**, and **Add and edit wishlist**
   permissions. Choose an expiry appropriate for the integration.
2. Save that token as `CAPSULE_MCP_API_TOKEN` in the Capsule Vercel project's
   **Production** environment. It is the downstream REST credential and stays
   on the server. Do not give it to the model or put it in MCP tool arguments.
3. Generate a separate random access key, for example with `openssl rand -hex 32`.
   Save it as `CAPSULE_MCP_ACCESS_KEY` in Vercel's **Production** environment.
   Keep both variables sensitive and server-only; neither uses `NEXT_PUBLIC_`.
4. Redeploy Capsule after setting the variables.
5. Configure Instinct's MCP connection with the endpoint above and securely store
   the header `Authorization: Bearer <MCP access key>` in its credential settings.
   Use the separate access key from step 3, not the Capsule REST token.
6. Discover the tools, then try one intended addition. A successful result has
   `ok: true`, an item `id`, and `verification.status: "verified"`.

Never put either credential in a prompt, query string, repository, or tool input.
Tool results contain no credentials or raw upstream error messages.

This is a **single-owner bridge**: everyone with its access key can use these two
tools against the configured account. It is not a public, multi-account sign-in
service. The endpoint returns 503 until both credentials are configured, and 401
for unauthenticated requests once configured. Browser cross-origin calls are
rejected. Authenticated GET/DELETE return 405; streaming and sessions are not used.

To rotate the client key, update `CAPSULE_MCP_ACCESS_KEY`, redeploy, and update the
client's secure header. To stop writes immediately, revoke the underlying Capsule
token in Settings. Its chosen expiry and account permissions still apply.

## Tool inputs

Both tools accept all [REST create fields](integrations.md#add-to-wishlist-or-wardrobe),
including product URLs, prices, descriptions, and front/back/side photo URLs or
uploads. The REST validation and image limits still apply. They also accept an
optional `idempotencyKey` (8–200 letters, digits, `.`, `_`, `:`, or `-`).

Example arguments for `create_wishlist_item`:

```json
{
  "url": "https://shop.example/products/jacket",
  "size": "M",
  "idempotencyKey": "shopping-session-123-jacket"
}
```

For details already read by the agent, use `fetch: false` and provide a `name`.
Prices are strings and currencies are three uppercase letters, as in the REST API.
Background removal remains an on-device browser operation. These first two tools
do not expose edits, purchases, deletion, or outfit rendering.

## Retries and verification

Supply one stable key per intended action and reuse it on every retry. If omitted,
the server derives a deterministic key from the destination and normalized input.
That key is stable across restarts and deployments; changing field order or
omitting the default `fetch: true` does not change it. A separate intentional
action with identical input requires a new explicit key. Existing REST duplicate
detection still applies even with a new key.

Each call first checks read access, POSTs the item, then GETs its returned ID.
Success requires the same ID and collection with a revision at least as recent
as the POST receipt. The response includes the ID, collection, idempotency key,
duplicate flag, sync status, and verification revision. `saved_to_cloud` means
the server saved it; `devices: "pending"` means browser sync has not been confirmed.

On an error, inspect `writeStatus`:

- `not_attempted`: the read-access check failed; no POST was sent.
- `rejected`: the API rejected the input, permissions, key, or request rate.
- `unknown`: the write may have completed; retry identical input with the same key.
- `saved_to_cloud` with unconfirmed verification: the POST succeeded but lookup
  failed. Retry with the same key; do not make a new item to compensate.

An old receipt cannot restore a subsequently removed item, so its verification
will fail. Raw product text and upstream error bodies are never included in tool
results. The API destination is fixed to Capsule's production origin and redirects
are rejected. The incoming MCP access key is never forwarded to the REST API.

Each successful call uses two lookups and one write. Existing account rate limits
apply, including to retries. No new database migration is required for MCP itself.

## Verification in development

`npm test` includes official SDK client discovery and execution tests, stable-key
retries, failed verification, credential protection, and hosted authentication.
With `TEST_INTEGRATION_DATABASE_URL` pointing to the disposable local
`capsule_integrations_test` database initialized from `db/schema.sql`, the suite
also exercises these tools against the actual REST handlers and PostgreSQL.
