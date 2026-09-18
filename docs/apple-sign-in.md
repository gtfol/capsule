# Sign in with Apple

Capsule's existing browser sign-in now supports Apple alongside Google, including the capsule scan companion authorization flow. Apple remains hidden until all four server environment variables are configured. No iPhone token or private key is bundled with the app.

## Apple Developer configuration

1. Enable **Sign in with Apple** on the existing App ID `dev.gtfol.capsulescan` as a primary App ID.
2. Register a Services ID for the web login (for example, `dev.gtfol.capsule.web`). Enable Sign in with Apple and associate it with that primary App ID.
3. Register domain `capsule.gtfol.dev` and return URL `https://capsule.gtfol.dev/api/auth/callback/apple`.
4. Create a Sign in with Apple key associated with that primary App ID. Download the `.p8` file once and store it securely. Do not commit it or paste it into an issue or chat.
5. Set these **server-only Production variables** on Capsule in Vercel, then redeploy:

| Variable | Value |
| --- | --- |
| `APPLE_CLIENT_ID` | The Services ID from step 2 |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `APPLE_KEY_ID` | ID of the Sign in with Apple key |
| `APPLE_PRIVATE_KEY` | Complete `.p8` PEM; multiline or escaped newlines |

The server signs a short-lived Apple client-secret JWT. Better Auth's instance is refreshed before that JWT expires. No manual six-month client-secret replacement is needed; the private key must remain valid.

## Verification before App Store submission

- `/api/sync/status` reports `providers.apple: true` only after configuration.
- Both Google and Apple buttons appear on `/scan/connect` and the web sign-in surfaces.
- Complete an Apple login from capsule scan, including Hide My Email; authorize the companion and save a test garment.
- Sign out and back into the same Apple account and verify the same wardrobe returns.
- An Apple private relay email can create a separate account from an existing Google account. Do not assume the two identities refer to the same person.
- With a disposable Apple account, delete the Capsule account from Settings. The server revokes the Apple refresh/access token before deleting account rows. If Apple is unavailable, deletion returns a retryable error and keeps the database record intact.
- Keep a dedicated App Review account available; never give reviewers a personal Google or Apple password. Capsule's env-gated email sign-in can support that test account.

No database migration is required. Existing Better Auth OAuth account columns store the provider tokens. This implementation assumes the existing Better Auth configuration does not enable `account.encryptOAuthTokens`; if that setting changes, update the revocation path to decrypt tokens before use.
