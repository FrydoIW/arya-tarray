import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { allocatePostingSequences, assertRebuildHasNoActiveTransferRelation, carryTransferDependencies, carryTransferReversalPreflight, postingSequenceCompare, validateCarryTransferIntegrity } from "../src/modules/member/time-based/member-carry-transfer.foundation.js";

const money = (value: string) => new Prisma.Decimal(value);
const subscriptions = [{ id: "sub-a", memberId: "member-a" }, { id: "sub-b", memberId: "member-a" }, { id: "sub-c", memberId: "member-a" }];
function transfer(id = "t1", overrides: Record<string, unknown> = {}) {
  return { id, memberId: "member-a", sourceSubscriptionId: "sub-a", destinationSubscriptionId: "sub-b", amount: money("100000"), status: "ACTIVE", idempotencyKey: `key-${id}`, requestHash: `hash-${id}`,
    reversalOfTransferId: null, ...overrides };
}
function entry(id: string, overrides: Record<string, unknown> = {}) {
  return { id, subscriptionId: "sub-b", carryTransferId: "t1", entryType: "TRANSFER_IN", entryStatus: "ACTIVE", amountDelta: money("100000"), postingSequence: 1n, ...overrides };
}
function validEntries() {
  return [entry("in"), entry("out", { subscriptionId: "sub-a", entryType: "TRANSFER_OUT", amountDelta: money("-100000") })];
}
function violations(transfers = [transfer()], entries = validEntries()) {
  return validateCarryTransferIntegrity({ transfers, entries, subscriptions });
}

test("posting sequences allocate monotonically per subscription", async () => {
  const tx = { memberEventBalanceLedger: { aggregate: async ({ where }: { where: { subscriptionId: string } }) => ({ _max: { postingSequence: where.subscriptionId === "sub-a" ? 7n : 2n } }) } };
  assert.deepEqual(await allocatePostingSequences(tx as never, "sub-a", 3), [8n, 9n, 10n]);
  assert.deepEqual(await allocatePostingSequences(tx as never, "sub-b", 2), [3n, 4n]);
});

test("posting sequence is causal order and ignores backdated effective dates", () => {
  const earlierPosting = entry("in", { postingSequence: 4n, effectiveDate: new Date("2030-01-01") });
  const laterPosting = entry("use", { carryTransferId: null, entryType: "COVERAGE_USE", amountDelta: money("-100000"), postingSequence: 5n, effectiveDate: new Date("2020-01-01") });
  assert.equal(postingSequenceCompare(earlierPosting, laterPosting), -1);
  assert.equal(carryTransferReversalPreflight({ transfer: transfer(), transfers: [transfer()], entries: [earlierPosting, laterPosting] }).reversible, false);
});

test("posting sequence uniqueness is verified per subscription", () => {
  const rows = validEntries(); rows.push(entry("duplicate", { subscriptionId: "sub-b", carryTransferId: null, entryType: "PAYMENT", amountDelta: money("1"), postingSequence: 1n }));
  assert.ok(violations([transfer()], rows).some(row => row.code === "duplicate_posting_sequence"));
});

test("paired transfer legs conserve the header amount", () => {
  assert.deepEqual(violations(), []);
});

test("missing transfer leg is detected", () => {
  assert.ok(violations([transfer()], [entry("in")]).some(row => row.code === "transfer_leg_pair_invalid"));
});

test("mismatched transfer amount and subscription are detected", () => {
  const rows = validEntries(); rows[0] = entry("in", { amountDelta: money("99999"), subscriptionId: "sub-c" });
  const result = violations([transfer()], rows);
  assert.ok(result.some(row => row.code === "transfer_leg_amount_mismatch"));
  assert.ok(result.some(row => row.code === "transfer_leg_subscription_mismatch"));
});

test("duplicate and conflicting idempotency keys are reported", () => {
  assert.ok(violations([transfer("t1"), transfer("t2", { idempotencyKey: "key-t1", requestHash: "hash-t1" })], [...validEntries(), ...validEntries().map(row => ({ ...row, id: `${row.id}-2`, carryTransferId: "t2" }))]).some(row => row.code === "duplicate_idempotency_key"));
  assert.ok(violations([transfer("t1"), transfer("t2", { idempotencyKey: "key-t1", requestHash: "different" })], [...validEntries(), ...validEntries().map(row => ({ ...row, id: `${row.id}-2`, carryTransferId: "t2" }))]).some(row => row.code === "conflicting_idempotency_key"));
});

test("later COVERAGE_USE blocks reversal and later PAYMENT never clears it", () => {
  const rows = [entry("in"), entry("use", { carryTransferId: null, entryType: "COVERAGE_USE", amountDelta: money("-100000"), postingSequence: 2n }), entry("payment", { carryTransferId: null, entryType: "PAYMENT", amountDelta: money("100000"), postingSequence: 3n })];
  const result = carryTransferReversalPreflight({ transfer: transfer(), transfers: [transfer()], entries: rows });
  assert.equal(result.reversible, false);
  assert.equal(result.dependencies[0]?.kind, "COVERAGE_USE");
});

test("later active TRANSFER_OUT is a downstream dependency and its reversal resolves it", () => {
  const downstream = transfer("t2", { sourceSubscriptionId: "sub-b", destinationSubscriptionId: "sub-c" });
  const rows = [entry("in"), entry("out-to-c", { entryType: "TRANSFER_OUT", amountDelta: money("-100000"), carryTransferId: "t2", postingSequence: 2n })];
  assert.equal(carryTransferReversalPreflight({ transfer: transfer(), transfers: [transfer(), downstream], entries: rows }).reversible, false);
  assert.equal(carryTransferReversalPreflight({ transfer: transfer(), transfers: [transfer(), { ...downstream, status: "REVERSED" }], entries: rows }).reversible, true);
});

test("current carry is not used as evidence that a transfer survived pooled consumption", () => {
  const rows = [entry("in"), entry("use", { carryTransferId: null, entryType: "COVERAGE_USE", amountDelta: money("-100000"), postingSequence: 2n }), entry("later-carry", { carryTransferId: null, entryType: "PAYMENT", amountDelta: money("100000"), postingSequence: 3n })];
  assert.equal(carryTransferReversalPreflight({ transfer: transfer(), transfers: [transfer()], entries: rows }).reversible, false);
});

test("transfer reversal must preserve amount and swap source/destination", () => {
  const original = transfer("t1");
  const badReversal = transfer("t2", { reversalOfTransferId: "t1" });
  assert.ok(violations([original, badReversal], [...validEntries(), ...validEntries().map(row => ({ ...row, id: `${row.id}-2`, carryTransferId: "t2" }))]).some(row => row.code === "transfer_reversal_mismatch"));
});

test("dependency inspection includes every later negative ledger type by default", () => {
  const rows = [entry("in"), entry("future-debit", { carryTransferId: null, entryType: "FUTURE_DEBIT", amountDelta: money("-1"), postingSequence: 2n })];
  const dependencies = carryTransferDependencies({ transfer: transfer(), transfers: [transfer()], entries: rows });
  assert.equal(dependencies[0]?.kind, "NEGATIVE_LEDGER");
  assert.equal(dependencies[0]?.resolved, false);
});

test("rebuild preflight refuses active transfer-related subscriptions and permits unrelated ones", async () => {
  const found = { memberEventCarryTransfer: { findFirst: async ({ where }: { where: { OR: Array<{ sourceSubscriptionId?: string; destinationSubscriptionId?: string }> } }) => where.OR.some(item => item.sourceSubscriptionId === "sub-a" || item.destinationSubscriptionId === "sub-a") ? { id: "t1" } : null } };
  await assert.rejects(() => assertRebuildHasNoActiveTransferRelation(found as never, "sub-a"), /Carry Transfer dependencies/);
  await assert.doesNotReject(() => assertRebuildHasNoActiveTransferRelation(found as never, "sub-c"));
});

function guardClient(options: { liveForward?: boolean; liveReversal?: { status: string } | null }) {
  return { memberEventCarryTransfer: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
    if (where.reversalOfTransferId === null) return options.liveForward ? { id: "forward" } : null;
    if (typeof where.reversalOfTransferId === "object")
      return options.liveReversal
        ? { id: "reversal", reversalOfTransferId: "original", reversalOf: { status: options.liveReversal.status } }
        : null;
    return null;
  } } };
}

test("rebuild preflight blocks a live forward transfer even without transfer-owned coverage", async () => {
  await assert.rejects(() => assertRebuildHasNoActiveTransferRelation(guardClient({ liveForward: true }) as never, "sub-a"),
    /Carry Transfer dependencies/);
});

test("rebuild preflight allows an active reversal whose original is REVERSED", async () => {
  await assert.doesNotReject(() => assertRebuildHasNoActiveTransferRelation(
    guardClient({ liveForward: false, liveReversal: { status: "REVERSED" } }) as never, "sub-a"));
});

test("rebuild preflight blocks an active reversal whose original is not REVERSED", async () => {
  await assert.rejects(() => assertRebuildHasNoActiveTransferRelation(
    guardClient({ liveForward: false, liveReversal: { status: "ACTIVE" } }) as never, "sub-a"), /Carry Transfer dependencies/);
});
