import assert from "node:assert/strict";
import test from "node:test";
import { requireSafeTestDatabaseUrl, assertConnectedDevDatabase } from "./integration/test-database.js";
import { applyBackendTestEnvironment } from "./integration/test-environment.js";
import { verifyDevDatabase } from "./integration/dev-preflight.js";
import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const dev = "mysql://example:placeholder@127.0.0.1:3306/arya_tarray_dev";
const acknowledged = { aryaEnv: "DEV", allowWrites: "true" };

test("packaged manual admin SQL has no legacy USE and gates all writes to exact current targets", () => {
  const sql = readFileSync(new URL("../prisma/bootstrap-admin.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /^\s*USE\b/im);
  assert.doesNotMatch(sql, /\barya_tarray(?:_test)?\b/);
  assert.match(sql, /CAST\(DATABASE\(\) AS BINARY\) IN \('arya_tarray_dev', 'arya_tarray_prod'\)/);
  assert.match(sql, /@target_allowed = 1 AND/);
  const writes = [...sql.matchAll(/INSERT INTO[\s\S]*?;/g)];
  assert.equal(writes.length, 3);
  for (const [statement] of writes) assert.match(statement, /WHERE @bootstrap_allowed = 1/);
});

test("integration runner accepts intentionally shared DEV application/test connection", () => {
  assert.equal(requireSafeTestDatabaseUrl(dev, dev, acknowledged), dev);
  for (const host of ["localhost", "[::1]"]) {
    const url = dev.replace("127.0.0.1", host);
    assert.equal(requireSafeTestDatabaseUrl(url, url, acknowledged), url);
  }
});

for (const database of ["arya_tarray_prod", "arya_tarray", "arya_tarray_test", "other", "arya_tarray_dev_backup", "ARYA_TARRAY_DEV", "arya_tarray_dev/", "%61rya_tarray_dev"]) {
  test(`integration guard rejects exact-target violation: ${database}`, () => {
    const url = dev.replace("arya_tarray_dev", database);
    assert.throws(() => requireSafeTestDatabaseUrl(url, url, acknowledged), /exactly arya_tarray_dev/);
  });
}

test("integration guard rejects missing/invalid URLs, remote hosts, redirects and conflicts", () => {
  assert.throws(() => requireSafeTestDatabaseUrl(undefined, dev, acknowledged), /TEST_DATABASE_URL is required/);
  assert.throws(() => requireSafeTestDatabaseUrl(dev, undefined, acknowledged), /DATABASE_URL is required/);
  assert.throws(() => requireSafeTestDatabaseUrl("invalid", dev, acknowledged), /valid MySQL/);
  for (const bad of [dev.replace("mysql:", "postgres:"), dev.replace("127.0.0.1", "db.example.invalid")]) {
    assert.throws(() => requireSafeTestDatabaseUrl(bad, bad, acknowledged), /loopback MySQL/);
  }
  for (const suffix of ["?socket=other", "?schema=arya_tarray_prod", "#arya_tarray_prod"]) {
    assert.throws(() => requireSafeTestDatabaseUrl(dev + suffix, dev + suffix, acknowledged), /exactly/);
  }
  assert.throws(() => requireSafeTestDatabaseUrl(dev, dev.replace("3306", "3307"), acknowledged), /conflict/);
  assert.throws(() => requireSafeTestDatabaseUrl(dev, dev.replace("placeholder", "different"), acknowledged), /conflict/);
  assert.throws(() => requireSafeTestDatabaseUrl(dev, dev.replace("arya_tarray_dev", "arya_tarray_prod"), acknowledged), /exactly/);
});

test("integration guard requires exact DEV marker and write acknowledgment", () => {
  for (const aryaEnv of [undefined, "PROD", "dev", "DEV "]) {
    assert.throws(() => requireSafeTestDatabaseUrl(dev, dev, { aryaEnv, allowWrites: "true" }), /ARYA_ENV=DEV/);
  }
  for (const allowWrites of [undefined, "false", "1", "TRUE"]) {
    assert.throws(() => requireSafeTestDatabaseUrl(dev, dev, { aryaEnv: "DEV", allowWrites }), /ALLOW_DEV_INTEGRATION_WRITES=true/);
  }
});

test("explicit backend environment loading precedes guard and rejects stale inherited selections", () => {
  const local = { DATABASE_URL: dev, TEST_DATABASE_URL: dev, ARYA_ENV: "DEV", ALLOW_DEV_INTEGRATION_WRITES: "true", ACCOUNTING_CUTOVER_DATE: "2026-10-01" };
  const inherited: NodeJS.ProcessEnv = {};
  applyBackendTestEnvironment(local, inherited);
  assert.equal(requireSafeTestDatabaseUrl(inherited.TEST_DATABASE_URL, inherited.DATABASE_URL,
    { aryaEnv: inherited.ARYA_ENV, allowWrites: inherited.ALLOW_DEV_INTEGRATION_WRITES }), dev);
  applyBackendTestEnvironment(local, inherited);
  for (const key of Object.keys(local)) {
    assert.throws(() => applyBackendTestEnvironment(local, { [key]: "stale-value" }), /Stale\/conflicting/);
  }
});

test("actual SELECT DATABASE mismatch aborts preflight before any schema/fixture access", async () => {
  assert.doesNotThrow(() => assertConnectedDevDatabase("arya_tarray_dev"));
  for (const name of [null, undefined, "arya_tarray_prod", "arya_tarray", "arya_tarray_test", "other"]) {
    assert.throws(() => assertConnectedDevDatabase(name), /SELECT DATABASE\(\) mismatch/);
    let calls = 0;
    const fake = { $queryRaw: async () => { calls++; return [{ name }]; } } as unknown as PrismaClient;
    await assert.rejects(verifyDevDatabase(fake), /mismatch/);
    assert.equal(calls, 1);
  }
});
