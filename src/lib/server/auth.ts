import { betterAuth, type BetterAuthOptions } from "better-auth";
import { dbConfigured, getPool } from "./db";
import { appleClientSecret, appleCredentials } from "./apple-auth";

let instance: ReturnType<typeof betterAuth> | null = null;
let renewAt = 0;
export function authConfigured(): boolean {
  return dbConfigured() && Boolean(process.env.BETTER_AUTH_SECRET);
}
export function enabledProviders() {
  const enabled = authConfigured();
  return {
    google: enabled && Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    apple: enabled && Boolean(appleCredentials()),
    email: enabled && Boolean(process.env.EMAIL_PASSWORD_AUTH),
  };
}
export function getAuth() {
  if (!authConfigured()) return null;
  if (!instance || Date.now() >= renewAt) {
    const providers = enabledProviders();
    const options: BetterAuthOptions = {
      appName: "Capsule",
      database: getPool(),
      secret: process.env.BETTER_AUTH_SECRET,
      baseURL: process.env.BETTER_AUTH_URL,
      trustedOrigins: ["https://appleid.apple.com"],
      emailAndPassword: { enabled: providers.email },
      socialProviders: {
        ...(providers.google && { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! } }),
        ...(providers.apple && { apple: async () => {
          const credentials = appleCredentials()!;
          return { clientId: credentials.clientId, clientSecret: await appleClientSecret(credentials) };
        } }),
      },
    };
    instance = betterAuth(options);
    // Better Auth resolves providers when creating the context. Refresh before the JWT expires.
    renewAt = Date.now() + 12 * 60 * 60 * 1000;
  }
  return instance;
}
