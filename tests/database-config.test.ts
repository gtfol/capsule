import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "pg";
import { databasePoolConfig } from "../src/lib/server/db";

test("remote Postgres TLS stays verified through pg parsing even with insecure URL options", () => {
  const config = databasePoolConfig("postgresql://alice:p%40ss@aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true&ssl=no-verify&host=localhost");
  assert.equal(config.host, "aws-0-us-west-1.pooler.supabase.com");
  assert.equal(config.password, "p@ss");
  assert.equal(config.connectionString, undefined);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  // Constructing a Client parses configuration without opening a connection.
  assert.deepEqual(new Client(config).ssl, { rejectUnauthorized: true });
});

test("only parsed loopback hostnames disable TLS, never credentials or name substrings", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(databasePoolConfig(`postgres://user:password@${host}/capsule`).ssl, false);
  }
  for (const address of [
    "postgres://localhost:127.0.0.1@db.example/capsule",
    "postgres://user:password@localhost.example/capsule",
    "postgres://user:password@db.example/localhost",
  ]) assert.deepEqual(databasePoolConfig(address).ssl, { rejectUnauthorized: true });
});

test("a custom CA is retained and cannot be replaced by sslmode or sslrootcert", () => {
  const certificate = "-----BEGIN CERTIFICATE-----\\nexample\\n-----END CERTIFICATE-----";
  const config = databasePoolConfig("postgres://user:password@db.example/capsule?sslmode=require&sslrootcert=/does-not-exist", certificate);
  const ssl = { rejectUnauthorized: true, ca: certificate.replace(/\\n/g, "\n") };
  assert.deepEqual(config.ssl, ssl);
  assert.deepEqual(new Client(config).ssl, ssl);
});

test("invalid database URLs produce an error without echoing credentials", () => {
  assert.throws(() => databasePoolConfig("postgres://private-password@"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes("private-password"));
    return true;
  });
  assert.throws(() => databasePoolConfig("https://db.example/database"), /valid Postgres/);
});
