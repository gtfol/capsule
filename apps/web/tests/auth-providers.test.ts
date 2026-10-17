import assert from "node:assert/strict";
import test from "node:test";
import { enabledProviders } from "../src/lib/server/auth";

test("Google login requires its credentials and retired Apple configuration cannot enable login", () => {
  const keys = ["DATABASE_URL", "BETTER_AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "EMAIL_PASSWORD_AUTH", "APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"];
  const previous = keys.map(key => [key, process.env[key]] as const);
  try {
    for (const key of keys) delete process.env[key];
    assert.deepEqual(enabledProviders(), { google: false, apple: false, email: false });
    process.env.DATABASE_URL = "postgres://localhost/capsule_test";
    process.env.BETTER_AUTH_SECRET = crypto.randomUUID();
    for (const key of keys.filter(key => key.startsWith("APPLE_"))) process.env[key] = crypto.randomUUID();
    assert.deepEqual(enabledProviders(), { google: false, apple: false, email: false });
    process.env.GOOGLE_CLIENT_ID = crypto.randomUUID();
    assert.equal(enabledProviders().google, false);
    process.env.GOOGLE_CLIENT_SECRET = crypto.randomUUID();
    assert.deepEqual(enabledProviders(), { google: true, apple: false, email: false });
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
