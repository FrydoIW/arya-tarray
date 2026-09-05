import assert from "node:assert/strict";
import test from "node:test";
import { BackfillDryRunAnalyzer, parseBackfillOptions } from "../src/modules/member/member-identity/member-backfill.js";
import { collectIdentityObservations, type DiscoveryTransaction } from "../src/modules/member/member-identity/member-identity.service.js";
import { normalizeIdentityName } from "../src/modules/member/member-identity/member-identity.utils.js";
import { parseVerifyOptions, summarizeIntegrityChecks } from "../src/modules/member/member-identity/member-integrity.js";

const amount = (value: string) => ({ toString: () => value });
function transaction(id: string, overrides: Partial<DiscoveryTransaction> = {}): DiscoveryTransaction {
  return { id, statementUploadId: "statement-1", senderName: "Budi Santoso", transactionType: "TRANSFER CR",
    originalAmount: amount("100017.00"), createdAt: new Date("2026-09-01T00:00:00Z"), memberIdentityId: null, ...overrides };
}

test("backfill CLI requires an explicit safe mode and validates bounds", () => {
  assert.throws(() => parseBackfillOptions([]), /explicit mode/);
  assert.deepEqual(parseBackfillOptions(["--dry-run", "--batch-size=250", "--limit=1000"]), { mode: "dry-run", batchSize: 250, limit: 1000 });
  assert.deepEqual(parseBackfillOptions(["--apply"]), { mode: "apply", batchSize: 500 });
  assert.throws(() => parseBackfillOptions(["--dry-run", "--apply"]), /exactly one/);
  assert.throws(() => parseBackfillOptions(["--dry-run", "--batch-size=0"]), /integer/);
});

test("dry-run analyzer shares Execute discovery rules and exposes no mutation dependency", async () => {
  const rows = [transaction("1"), transaction("2", { senderName: "  budi   santoso " }),
    transaction("3", { transactionType: "BIAYA ADM", originalAmount: amount("-7500.00") }),
    transaction("4", { senderName: "N/A" })];
  const canonical = collectIdentityObservations(rows);
  let lookupCalls = 0; let mutationCalls = 0;
  const analyzer = new BackfillDryRunAnalyzer();
  const result = await analyzer.analyzeBatch(rows, async keys => { lookupCalls++; assert.deepEqual(keys, canonical.observations.map(item => item.identityKey)); return []; });
  assert.equal(lookupCalls, 1); assert.equal(mutationCalls, 0);
  assert.equal(result.eligibleIncomingTransactions, canonical.eligible + 1);
  assert.equal(result.skippedNonIncomingTransactions, 1); assert.equal(result.skippedUnusableSenderIdentities, 1);
  assert.equal(result.distinctIdentityKeys, 1); assert.equal(result.identitiesWouldBeCreated, 1); assert.equal(result.transactionsWouldBeLinked, 2);
  assert.equal(normalizeIdentityName(rows[1].senderName!), "BUDI SANTOSO");
  mutationCalls += 0;
});

test("dry-run reports linked, VERIFIED and UNVERIFIED states without changing ownership", async () => {
  const existingKey = collectIdentityObservations([transaction("1")]).observations[0].identityKey;
  const analyzer = new BackfillDryRunAnalyzer();
  const result = await analyzer.analyzeBatch([
    transaction("linked", { memberIdentityId: "identity-linked" }), transaction("new-unlinked")
  ], async () => [{ identityKey: existingKey, verificationStatus: "VERIFIED", memberId: "member-a" }]);
  assert.equal(result.alreadyLinkedTransactions, 1); assert.equal(result.identitiesWouldBeReused, 1);
  assert.equal(result.verifiedIdentitiesWithMembers, 1); assert.equal(result.conflicts, 0);
});

test("dry-run skips an already-linked-only row without an identity lookup or projected write", async () => {
  const analyzer = new BackfillDryRunAnalyzer();
  let lookupCalls = 0;
  const result = await analyzer.analyzeBatch([
    transaction("linked", { memberIdentityId: "identity-linked" })
  ], async () => { lookupCalls++; return []; });
  assert.equal(lookupCalls, 0);
  assert.equal(result.scannedTransactions, 1);
  assert.equal(result.alreadyLinkedTransactions, 1);
  assert.equal(result.transactionsWouldBeLinked, 0);
  assert.equal(result.identitiesWouldBeCreated, 0);
});

test("dry-run and integrity summary are clean for zero data", async () => {
  const analyzer = new BackfillDryRunAnalyzer();
  let lookupCalls = 0;
  const result = await analyzer.analyzeBatch([], async () => { lookupCalls++; return []; });
  assert.equal(lookupCalls, 0);
  assert.deepEqual(result, {
    scannedTransactions: 0, eligibleIncomingTransactions: 0, alreadyLinkedTransactions: 0,
    skippedNonIncomingTransactions: 0, skippedUnusableSenderIdentities: 0, distinctIdentityKeys: 0,
    identitiesWouldBeReused: 0, identitiesWouldBeCreated: 0, transactionsWouldBeLinked: 0,
    verifiedIdentitiesWithMembers: 0, unverifiedIdentities: 0, conflicts: 0, errors: 0
  });
  assert.equal(summarizeIntegrityChecks([]).status, "PASS");
});

test("batch boundaries and stateless rerun do not project duplicate identities", async () => {
  const first = new BackfillDryRunAnalyzer();
  await first.analyzeBatch([transaction("1")], async () => []);
  const afterSecondBatch = await first.analyzeBatch([transaction("2")], async () => []);
  assert.equal(afterSecondBatch.identitiesWouldBeCreated, 1);
  assert.equal(afterSecondBatch.transactionsWouldBeLinked, 2);

  const key = collectIdentityObservations([transaction("1")]).observations[0].identityKey;
  const rerun = new BackfillDryRunAnalyzer();
  const rerunResult = await rerun.analyzeBatch([transaction("2")], async () => [{ identityKey: key, verificationStatus: "UNVERIFIED", memberId: null }]);
  assert.equal(rerunResult.identitiesWouldBeCreated, 0); assert.equal(rerunResult.identitiesWouldBeReused, 1);
  assert.equal(rerunResult.unverifiedIdentities, 1);
});

test("integrity summary detects representative broken states and accepts zero-data state", () => {
  const valid = [{ name: "orphan", violationCount: 0, examples: [] }];
  assert.equal(summarizeIntegrityChecks(valid).status, "PASS");
  const broken = [...valid, { name: "verified_without_member", violationCount: 2, examples: ["id-1"] }];
  assert.deepEqual(summarizeIntegrityChecks(broken), { status: "FAIL", totalChecks: 2, failedChecks: 1, totalViolations: 2 });
  assert.deepEqual(parseVerifyOptions([]), { help: false, exampleLimit: 5 });
  assert.throws(() => parseVerifyOptions(["--limit=0"]), /integer/);
});
