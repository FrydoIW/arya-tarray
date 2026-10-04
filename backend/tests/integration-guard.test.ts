import assert from "node:assert/strict";
import test from "node:test";
import { requireSafeTestDatabaseUrl } from "./integration/test-database.js";

test("integration runner rejects missing, normal, remote, and shared database targets", () => {
  assert.throws(() => requireSafeTestDatabaseUrl(undefined, undefined), /TEST_DATABASE_URL is required/);
  assert.throws(() => requireSafeTestDatabaseUrl("mysql://u:p@127.0.0.1:3306/arya_tarray", undefined), /arya_tarray_test/);
  assert.throws(() => requireSafeTestDatabaseUrl("mysql://u:p@db.example.test/arya_tarray_test", undefined), /loopback/);
  assert.throws(() => requireSafeTestDatabaseUrl("mysql://u:p@127.0.0.1:3306/arya_tarray_test",
    "mysql://other:secret@127.0.0.1:3306/arya_tarray_test"), /must not target/);
});

test("integration runner accepts a separate loopback test database only", () => {
  const url = "mysql://test_user:secret@127.0.0.1:3306/arya_tarray_test";
  assert.equal(requireSafeTestDatabaseUrl(url, "mysql://app_user:secret@127.0.0.1:3306/arya_tarray"), url);
});
