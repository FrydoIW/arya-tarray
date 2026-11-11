import assert from "node:assert/strict";
import test from "node:test";
import { requireSafeTestDatabaseUrl, assertConnectedTestDatabase } from "./integration/test-database.js";
import { applyBackendTestEnvironment } from "./integration/test-environment.js";
import { verifyTestDatabase } from "./integration/dev-preflight.js";
import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const dev = "mysql://example:placeholder@127.0.0.1:3306/arya_tarray_dev";
const isolated = dev.replace("arya_tarray_dev", "arya_tarray_test");
const acknowledged = { aryaEnv: "TEST", allowWrites: "true" };

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

test("integration runner accepts only explicitly selected isolated TEST connection", () => {
  assert.equal(requireSafeTestDatabaseUrl(isolated, undefined, acknowledged), isolated);
  for (const host of ["localhost", "[::1]"]) {
    const url = isolated.replace("127.0.0.1", host);
    assert.equal(requireSafeTestDatabaseUrl(url, url, acknowledged), url);
  }
});

for (const database of ["arya_tarray_prod", "arya_tarray", "arya_tarray_dev", "other", "arya_tarray_test_backup", "ARYA_TARRAY_TEST", "arya_tarray_test/", "%61rya_tarray_test"]) {
  test(`integration guard rejects exact-target violation: ${database}`, () => {
    const url = isolated.replace("arya_tarray_test", database);
    assert.throws(() => requireSafeTestDatabaseUrl(url, url, acknowledged), /exactly arya_tarray_test/);
  });
}

test("integration guard rejects missing/invalid URLs, remote hosts, redirects and conflicts", () => {
  assert.throws(() => requireSafeTestDatabaseUrl(undefined, dev, acknowledged), /TEST_DATABASE_URL is required/);
  assert.throws(() => requireSafeTestDatabaseUrl("invalid", dev, acknowledged), /valid MySQL/);
  for (const bad of [isolated.replace("mysql:", "postgres:"), isolated.replace("127.0.0.1", "db.example.invalid")]) {
    assert.throws(() => requireSafeTestDatabaseUrl(bad, bad, acknowledged), /loopback MySQL/);
  }
  for (const suffix of ["?socket=other", "?schema=arya_tarray_prod", "#arya_tarray_prod"]) {
    assert.throws(() => requireSafeTestDatabaseUrl(isolated + suffix, isolated + suffix, acknowledged), /exactly/);
  }
  assert.throws(() => requireSafeTestDatabaseUrl(isolated, isolated.replace("3306", "3307"), acknowledged), /conflict/);
  assert.throws(() => requireSafeTestDatabaseUrl(isolated, isolated.replace("placeholder", "different"), acknowledged), /conflict/);
  assert.throws(() => requireSafeTestDatabaseUrl(isolated, dev, acknowledged), /exactly/);
});

test("integration guard requires exact TEST marker and write acknowledgment", () => {
  for (const aryaEnv of [undefined, "DEV", "PROD", "test", "TEST "]) {
    assert.throws(() => requireSafeTestDatabaseUrl(isolated, isolated, { aryaEnv, allowWrites: "true" }), /ARYA_ENV=TEST/);
  }
  for (const allowWrites of [undefined, "false", "1", "TRUE"]) {
    assert.throws(() => requireSafeTestDatabaseUrl(isolated, isolated, { aryaEnv: "TEST", allowWrites }), /ALLOW_TEST_INTEGRATION_WRITES=true/);
  }
});

test("test loader never inherits DEV selection or cutover and rejects conflicting process connections", () => {
  const local = { DATABASE_URL: dev, TEST_DATABASE_URL: dev, ARYA_ENV: "DEV", ALLOW_DEV_INTEGRATION_WRITES: "true", ACCOUNTING_CUTOVER_DATE: "2026-10-01" };
  assert.throws(() => applyBackendTestEnvironment(local, {}), /ARYA_ENV=TEST/);
  const inherited: NodeJS.ProcessEnv = { ARYA_ENV: "TEST", TEST_DATABASE_URL: isolated, ALLOW_TEST_INTEGRATION_WRITES: "true" };
  applyBackendTestEnvironment(local, inherited);
  assert.equal(requireSafeTestDatabaseUrl(inherited.TEST_DATABASE_URL, inherited.DATABASE_URL,
    { aryaEnv: inherited.ARYA_ENV, allowWrites: inherited.ALLOW_TEST_INTEGRATION_WRITES }), isolated);
  assert.equal(inherited.ACCOUNTING_CUTOVER_DATE, undefined);
  assert.equal(inherited.ALLOW_DEV_INTEGRATION_WRITES, undefined);
  applyBackendTestEnvironment(local, inherited);
  assert.throws(() => applyBackendTestEnvironment(local, { ...inherited, DATABASE_URL: dev }), /exactly/);
});

test("actual SELECT DATABASE mismatch aborts preflight before any schema/fixture access", async () => {
  assert.doesNotThrow(() => assertConnectedTestDatabase("arya_tarray_test"));
  for (const name of [null, undefined, "arya_tarray_prod", "arya_tarray", "arya_tarray_dev", "other"]) {
    assert.throws(() => assertConnectedTestDatabase(name), /SELECT DATABASE\(\) mismatch/);
    let calls = 0;
    const fake = { $queryRaw: async () => { calls++; return [{ name }]; } } as unknown as PrismaClient;
    await assert.rejects(verifyTestDatabase(fake), /mismatch/);
    assert.equal(calls, 1);
  }
});
