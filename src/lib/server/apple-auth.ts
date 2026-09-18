import { importPKCS8, SignJWT } from "jose";

export type AppleCredentials = { clientId: string; teamId: string; keyId: string; privateKey: string };
export function appleCredentials(env: Record<string, string | undefined> = process.env): AppleCredentials | null {
  const { APPLE_CLIENT_ID: clientId, APPLE_TEAM_ID: teamId, APPLE_KEY_ID: keyId, APPLE_PRIVATE_KEY: privateKey } = env;
  return clientId && teamId && keyId && privateKey ? { clientId, teamId, keyId, privateKey } : null;
}

export async function appleClientSecret(credentials: AppleCredentials, now = Math.floor(Date.now() / 1000)) {
  const key = await importPKCS8(credentials.privateKey.replace(/\\n/g, "\n"), "ES256");
  return new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: credentials.keyId })
    .setIssuer(credentials.teamId).setSubject(credentials.clientId).setAudience("https://appleid.apple.com")
    .setIssuedAt(now).setExpirationTime(now + 86400).sign(key);
}

export type AppleAccountTokens = { refreshToken: string | null; accessToken: string | null };
export async function revokeAppleAccess(accounts: AppleAccountTokens[], credentials = appleCredentials(), send: typeof fetch = fetch) {
  if (!accounts.length) return;
  if (!credentials) throw new Error("Apple account revocation is unavailable.");
  const clientSecret = await appleClientSecret(credentials);
  for (const account of accounts) {
    const token = account.refreshToken || account.accessToken;
    if (!token) throw new Error("Apple account revocation is unavailable.");
    const response = await send("https://appleid.apple.com/auth/revoke", {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: credentials.clientId, client_secret: clientSecret, token,
        token_type_hint: account.refreshToken ? "refresh_token" : "access_token" }),
    });
    // Never log or expose Apple's response or credentials. Account deletion can be retried.
    if (!response.ok) throw new Error("Apple account revocation is unavailable.");
  }
}
