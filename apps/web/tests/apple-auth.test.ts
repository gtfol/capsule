import assert from "node:assert/strict";
import test from "node:test";
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { appleClientSecret, appleCredentials, revokeAppleAccess } from "../src/lib/server/apple-auth";

async function fixture() {
  const keys = await generateKeyPair("ES256", { extractable: true });
  return { keys, credentials: { clientId: "dev.example.web", teamId: "TEST_TEAM", keyId: "TEST_KEY", privateKey: await exportPKCS8(keys.privateKey) } };
}
test("Apple is disabled unless every server credential is present", () => {
  assert.equal(appleCredentials({}), null);
  assert.equal(appleCredentials({ APPLE_CLIENT_ID: "example" }), null);
});
test("Apple client secret has a valid signature, exact audience and bounded lifetime", async () => {
  const { keys, credentials } = await fixture();
  const now = Math.floor(Date.now() / 1000);
  const token = await appleClientSecret({ ...credentials, privateKey: credentials.privateKey.replaceAll("\n", "\\n") }, now);
  const { payload, protectedHeader } = await jwtVerify(token, keys.publicKey, {
    algorithms: ["ES256"], audience: "https://appleid.apple.com", issuer: credentials.teamId, subject: credentials.clientId,
  });
  assert.equal(protectedHeader.kid, credentials.keyId);
  assert.equal(payload.iat, now);
  assert.equal(payload.exp, now + 86400);
});
test("account deletion revokes refresh token at Apple without sending it elsewhere", async () => {
  const { credentials } = await fixture();
  let calls = 0;
  const ephemeralToken = crypto.randomUUID();
  const send: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://appleid.apple.com/auth/revoke");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    const body = init?.body as URLSearchParams;
    assert.equal(body.get("client_id"), credentials.clientId);
    assert.equal(body.get("token"), ephemeralToken);
    assert.equal(body.get("token_type_hint"), "refresh_token");
    return new Response(null, { status: 200 });
  };
  await revokeAppleAccess([{ refreshToken: ephemeralToken, accessToken: crypto.randomUUID() }], credentials, send);
  assert.equal(calls, 1);
});
test("revocation failures stay generic and retryable; non-Apple accounts need no configuration", async () => {
  await revokeAppleAccess([], null, async () => { throw new Error("must not fetch"); });
  const { credentials } = await fixture();
  const account = { refreshToken: crypto.randomUUID(), accessToken: null };
  await assert.rejects(revokeAppleAccess([account], null), { message: "Apple account revocation is unavailable." });
  await assert.rejects(revokeAppleAccess([account], credentials, async () => new Response("sensitive response", { status: 500 })),
    { message: "Apple account revocation is unavailable." });
  await assert.rejects(revokeAppleAccess([{ refreshToken: null, accessToken: null }], credentials),
    { message: "Apple account revocation is unavailable." });
});
