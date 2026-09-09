import { betterAuth, type BetterAuthOptions } from "better-auth";
import { dbConfigured, getPool } from "./db";

let instance: ReturnType<typeof betterAuth> | null = null;
export function authConfigured(): boolean {
  return dbConfigured() && Boolean(process.env.BETTER_AUTH_SECRET);
}
export function enabledProviders() {
  const enabled = authConfigured();
  return {
    google: enabled && Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    email: enabled && Boolean(process.env.EMAIL_PASSWORD_AUTH),
  };
}
export function getAuth() {
  if (!authConfigured()) return null;
  if (!instance) {
    const providers = enabledProviders();
    const options: BetterAuthOptions = {
      appName: "Capsule",
      database: getPool(),
      secret: process.env.BETTER_AUTH_SECRET,
      baseURL: process.env.BETTER_AUTH_URL,
      emailAndPassword: { enabled: providers.email },
      socialProviders: {
        ...(providers.google && { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! } }),
      },
    };
    instance = betterAuth(options);
  }
  return instance;
}
