import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { addOpeningCoverageRecord, pendingTimeBasedPaymentPreview, updateSubscriptionRecord, voidOpeningCoverageRecord, retryAllocationRecord } from "../src/modules/member/data/member-data.service.js";
import { calculateCarryGrant, manuallyAllocateTimeBasedPayment, reconcileTimeBasedCoverageForIdentity, rebuildTimeBasedSubscription, selectHistoricalPaymentSnapshot, synchronizePendingTimeBasedForMember, synchronizeTimeBasedTransaction } from "../src/modules/member/time-based/member-time-based.service.js";
import { assertNoOutstandingTimeBasedCarry } from "../src/modules/configuration/event-code/event-time-rule.service.js";
import { loadDashboardTimeBasedCarry, loadDashboardTimeBasedSummary, summarizeTimeBasedCarry } from "../src/modules/monitoring/dashboard/dashboard.repository.js";
import { pendingTimeBasedPaymentsWhere } from "../src/modules/member/data/member-data.repository.js";

const d = (value: string) => new Prisma.Decimal(value);
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
test("TIME_BASED wallet keeps classification suffix money in carry", () => {
  assert.deepEqual(calculateCarryGrant(0n, 250004n, 150000n), { grantedUnits: 1, amountConsumed: 150000n, carryBalance: 100004n });
  assert.deepEqual(calculateCarryGrant(0n, 1150003n, 100000n), { grantedUnits: 11, amountConsumed: 1100000n, carryBalance: 50003n });
  assert.deepEqual(calculateCarryGrant(0n, 500001n, 50000n), { grantedUnits: 10, amountConsumed: 500000n, carryBalance: 1n });
});
type Payment = ReturnType<typeof payment>;
function payment(id: string, amount: string, date = "2026-01-31", memberId: string | null = "member-a") {
  return { id, transactionDate: day(date), referenceNo: id, originalAmount: d(amount), baseAmount: d(amount),
    status: "FINALIZED", reconciliationExcludedAt: null as Date | null, eventCodeId: "rupang",
    eventCode: { id: "rupang", code: "091", eventName: "Rupang", eventType: "TIME_BASED",
      timeRule: { unitAmount: d("50000"), durationMonths: 1, activeFlag: true } },
    memberIdentity: { memberId, verificationStatus: "VERIFIED" } };
}
type Sub = { id: string; memberId: string; eventCodeId: string; startDate: Date | null; validUntil: Date | null; activeFlag: boolean; referenceNo: string | null; displayName: string | null; remark: string | null };
type Entry = { id: string; subscriptionId: string; bankTransactionId: string | null; coverageId: string | null;
  entryType: string; entryStatus: string; amountDelta: Prisma.Decimal; effectiveDate: Date;
  postingSequence: bigint;
  unitAmountSnapshot: Prisma.Decimal | null; durationMonthsSnapshot: number | null; createdAt: Date;
  voidReason: string | null };
type Coverage = { id: string; subscriptionId: string; bankTransactionId: string | null; coverageSource: string;
  coverageStatus: string; coverageFrom: Date; coverageTo: Date; unitAmountSnapshot: Prisma.Decimal | null;
  durationMonthsSnapshot: number | null; grantedUnits: number | null; amountApplied: Prisma.Decimal | null;
  createdAt: Date; voidReason: string | null };

function fixture() {
  const payments: Payment[] = [];
  const subs: Sub[] = [{ id: "sub-a", memberId: "member-a", eventCodeId: "rupang", startDate: null,
    validUntil: null, activeFlag: true, referenceNo: "Rupang #17", displayName: null, remark: null }];
  const entries: Entry[] = [];
  const coverages: Coverage[] = [];
  let activeTransferRelation = false;
  let sequence = 0;
  const id = () => String(++sequence).padStart(5, "0");
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => key === "subscription"
      ? subs.some(sub => sub.id === row.subscriptionId && sub.memberId === (value as { memberId: string }).memberId)
      : key === "id" && typeof value === "object" && value !== null && "in" in value
      ? (value.in as string[]).includes(String(row.id))
      : typeof value === "string" ? row[key] === value : true);
  const decorateEntry = (row: Entry) => ({ ...row, subscription: subs.find(sub => sub.id === row.subscriptionId)! });
  const decorateCoverage = (row: Coverage) => ({ ...row, subscription: subs.find(sub => sub.id === row.subscriptionId)! });
  const tx = {
    bankTransaction: {
      findUnique: async ({ where }: { where: { id: string } }) => payments.find(row => row.id === where.id) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) => payments.filter(row => {
        if (where.id && !matches(row, { id: where.id })) return false;
        if (where.memberIdentityId && where.memberIdentityId !== "identity") return false;
        if (where.memberIdentity && row.memberIdentity.memberId !== (where.memberIdentity as { is: { memberId: string } }).is.memberId) return false;
        return true;
      })
    },
    memberEventSubscription: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = subs.find(item => item.id === where.id);
        return row ? { ...row } : null;
      },
      findMany: async ({ where }: { where: { memberId: string; eventCodeId: string; activeFlag: boolean } }) =>
        subs.filter(row => row.memberId === where.memberId && row.eventCodeId === where.eventCodeId && row.activeFlag === where.activeFlag),
      create: async ({ data }: { data: Pick<Sub, "memberId" | "eventCodeId" | "activeFlag"> }) => {
        const row: Sub = { id: `sub-${id()}`, memberId: data.memberId, eventCodeId: data.eventCodeId,
          activeFlag: data.activeFlag, startDate: null, validUntil: null, referenceNo: null, displayName: null, remark: null };
        subs.push(row); return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Sub> }) => {
        const row = subs.find(item => item.id === where.id)!; Object.assign(row, data); return row;
      }
    },
    memberEventBalanceLedger: {
      aggregate: async ({ where }: { where: Record<string, unknown> }) => {
        const selected = entries.filter(row => matches(row, where));
        return { _sum: { amountDelta: selected.reduce((sum, row) => sum.plus(row.amountDelta), d("0")) },
          _max: { postingSequence: selected.reduce<bigint | null>((max, row) => max === null || row.postingSequence > max ? row.postingSequence : max, null) } };
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        entries.filter(row => matches(row, where)).slice().reverse().map(decorateEntry),
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        entries.find(row => matches(row, where)) ?? null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Entry> }) => {
        const rows = entries.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: id(), bankTransactionId: null, coverageId: null, postingSequence: 0n, unitAmountSnapshot: null,
          durationMonthsSnapshot: null, voidReason: null, ...data, amountDelta: d(String(data.amountDelta)),
          unitAmountSnapshot: data.unitAmountSnapshot ? d(String(data.unitAmountSnapshot)) : null,
          createdAt: new Date(2026, 0, sequence) } as Entry;
        entries.push(row); return decorateEntry(row);
      }
    },
    memberEventCarryTransfer: {
      findFirst: async () => activeTransferRelation ? { id: "transfer-a" } : null
    },
    memberEventCoverage: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        coverages.filter(row => matches(row, where)).slice().reverse().map(decorateCoverage),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.coverageSource === "OPENING") {
          const from = (where.coverageFrom as { lte: Date }).lte;
          const to = (where.coverageTo as { gte: Date }).gte;
          return coverages.find(row => row.subscriptionId === where.subscriptionId && row.coverageSource === "OPENING"
            && row.coverageStatus === "ACTIVE" && row.coverageFrom <= from && row.coverageTo >= to) ?? null;
        }
        return coverages.filter(row => matches(row, where)).sort((a, b) => b.coverageTo.getTime() - a.coverageTo.getTime())[0] ?? null;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Coverage> }) => {
        const rows = coverages.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: id(), bankTransactionId: null, unitAmountSnapshot: null, durationMonthsSnapshot: null,
          grantedUnits: null, amountApplied: null, voidReason: null, ...data,
          unitAmountSnapshot: data.unitAmountSnapshot ? d(String(data.unitAmountSnapshot)) : null,
          amountApplied: data.amountApplied ? d(String(data.amountApplied)) : null,
          createdAt: new Date(2026, 0, sequence) } as Coverage;
        coverages.push(row); return decorateCoverage(row);
      }
    }
  } as unknown as Prisma.TransactionClient;
  const sync = (transactionId: string, recalculate = false) => synchronizeTimeBasedTransaction(tx, transactionId, "admin", { recalculate });
  const active = () => entries.filter(row => row.entryStatus === "ACTIVE");
  const balance = (subId = "sub-a") => active().filter(row => row.subscriptionId === subId)
    .reduce((sum, row) => sum.plus(row.amountDelta), d("0")).toFixed(2);
  const activeCoverage = (subId = "sub-a") => coverages.filter(row => row.subscriptionId === subId && row.coverageStatus === "ACTIVE" && row.coverageSource === "TRANSACTION");
  return { tx, payments, subs, entries, coverages, sync, active, balance, activeCoverage,
    setActiveTransferRelation: (value: boolean) => { activeTransferRelation = value; } };
}

for (const [amount, months, carry] of [
  ["225000", 4, "25000.00"], ["25000", 0, "25000.00"], ["1025000", 20, "25000.00"]
] as const) test(`payment ${amount} grants ${months} months and carries ${carry}`, async () => {
  const f = fixture(); f.payments.push(payment("p1", amount));
  assert.equal((await f.sync("p1")).state, "ALLOCATED");
  assert.equal(f.activeCoverage().reduce((sum, row) => sum + (row.grantedUnits ?? 0), 0), months);
  assert.equal(f.balance(), carry);
  assert.equal(f.active().filter(row => row.entryType === "PAYMENT").length, 1);
  assert.equal(f.active().filter(row => row.entryType === "COVERAGE_USE").length, months ? 1 : 0);
  assert.equal(f.subs[0].validUntil === null, months === 0);
});

for (const [second, months] of [["25000", 1], ["75000", 2]] as const)
  test(`25k carry plus ${second} grants ${months} months with zero remainder`, async () => {
    const f = fixture(); f.payments.push(payment("p1", "25000"), payment("p2", second, "2026-02-01"));
    await f.sync("p1"); await f.sync("p2");
    assert.equal(f.activeCoverage().find(row => row.bankTransactionId === "p2")?.grantedUnits, months);
    assert.equal(f.balance(), "0.00");
  });

test("zero-unit payment is allocated, leaves validUntil unchanged, and repeated synchronization is idempotent", async () => {
  const f = fixture(); f.payments.push(payment("p1", "25000"));
  await f.sync("p1"); const history = f.entries.length;
  await f.sync("p1");
  assert.equal(f.entries.length, history);
  assert.equal(f.subs[0].validUntil, null);
  assert.equal(f.subs[0].startDate?.toISOString().slice(0, 10), "2026-01-31");
  assert.equal(f.active().filter(row => row.entryType === "PAYMENT").length, 1);
});

test("pending query excludes an ACTIVE PAYMENT even when no coverage exists", () => {
  const where = pendingTimeBasedPaymentsWhere("member-a");
  assert.deepEqual(where.memberEventBalanceLedger, { none: { entryType: "PAYMENT", entryStatus: "ACTIVE" } });
  assert.deepEqual(where.memberIdentity, { is: { memberId: "member-a", verificationStatus: "VERIFIED" } });
});

test("first finalized payment automatically creates one program and allocates its principal", async () => {
  const f = fixture(); f.subs.length = 0;
  const first = payment("p1", "250004", "2026-09-01");
  first.baseAmount = d("250000");
  first.eventCode.timeRule = { unitAmount: d("150000"), durationMonths: 3, activeFlag: true };
  f.payments.push(first);

  const result = await f.sync("p1");
  assert.equal(result.state, "ALLOCATED");
  assert.equal(f.subs.length, 1);
  assert.equal(f.subs[0].memberId, "member-a");
  assert.equal(f.subs[0].eventCodeId, "rupang");
  assert.equal(f.active().filter(row => row.entryType === "PAYMENT")[0].amountDelta.toFixed(2), "250004.00");
  assert.equal(f.active().filter(row => row.entryType === "COVERAGE_USE")[0].amountDelta.toFixed(2), "-150000.00");
  assert.equal(f.balance(f.subs[0].id), "100004.00");
  assert.equal(f.subs[0].startDate?.toISOString().slice(0, 10), "2026-09-01");
  assert.equal(f.activeCoverage(f.subs[0].id)[0].grantedUnits, 1);
  assert.equal(f.activeCoverage(f.subs[0].id)[0].coverageFrom.toISOString().slice(0, 10), "2026-09-01");
  assert.equal(f.activeCoverage(f.subs[0].id)[0].coverageTo.toISOString().slice(0, 10), "2026-11-30");
});

test("automatic program lifecycle reuses one active program and is idempotent", async () => {
  const f = fixture(); f.subs.length = 0; f.payments.push(payment("p1", "25000"));
  await f.sync("p1"); const historyCount = f.entries.length;
  await f.sync("p1");
  assert.equal(f.subs.length, 1);
  assert.equal(f.subs[0].startDate?.toISOString().slice(0, 10), "2026-01-31");
  assert.equal(f.entries.length, historyCount);
  f.payments.push(payment("p2", "25000", "2026-02-01"));
  assert.equal((await f.sync("p2")).subscriptionId, f.subs[0].id);
  assert.equal(f.subs.length, 1);
  assert.equal(f.subs[0].startDate?.toISOString().slice(0, 10), "2026-01-31");
});

test("member resync recovers a historic pending TIME_BASED payment into its automatic program", async () => {
  const f = fixture(); f.subs.length = 0; f.payments.push(payment("historic", "25000", "2025-12-01"));

  await synchronizePendingTimeBasedForMember(f.tx, "member-a", "admin");
  assert.equal(f.subs.length, 1);
  assert.equal(f.active().filter(row => row.bankTransactionId === "historic" && row.entryType === "PAYMENT").length, 1);
});

test("automatic program creation locks the active member-event range before it can create", async () => {
  const f = fixture(); f.subs.length = 0; f.payments.push(payment("p1", "25000"));
  const locks: unknown[] = [];
  (f.tx as unknown as { $queryRaw: (query: unknown) => Promise<unknown[]> }).$queryRaw = async query => {
    locks.push(query);
    return [];
  };

  await f.sync("p1");
  assert.equal(f.subs.length, 1);
  assert.ok(locks.some(query => /arya_member_event_subscription[\s\S]*active_flag = 1[\s\S]*FOR UPDATE/
    .test((query as { strings: string[] }).strings.join("?"))));
});

test("missing current TIME_BASED rule remains pending and never creates a fabricated program", async () => {
  const f = fixture(); f.subs.length = 0;
  const invalid = payment("p1", "25000");
  invalid.eventCode.timeRule.activeFlag = false;
  f.payments.push(invalid);

  assert.equal((await f.sync("p1")).state, "PENDING_SUBSCRIPTION");
  assert.equal(f.subs.length, 0);
  assert.equal(f.entries.length, 0);
  assert.equal(f.coverages.length, 0);
});

test("non-finalized TIME_BASED payment never creates a program or economic entries", async () => {
  const f = fixture(); f.subs.length = 0;
  const pending = payment("p1", "25000");
  pending.status = "CHECK";
  f.payments.push(pending);

  assert.equal((await f.sync("p1")).state, "NOT_TIME_BASED");
  assert.equal(f.subs.length, 0);
  assert.equal(f.entries.length, 0);
});

test("FINALIZED STANDARD and CAMPAIGN payments never enter the TIME_BASED lifecycle", async () => {
  for (const eventType of ["STANDARD", "CAMPAIGN"] as const) {
    const f = fixture(); f.subs.length = 0;
    const transaction = payment(eventType, "25000");
    transaction.eventCode.eventType = eventType;
    f.payments.push(transaction);
    assert.equal((await f.sync(eventType)).state, "NOT_TIME_BASED");
    assert.equal(f.subs.length, 0);
    assert.equal(f.entries.length, 0);
  }
});

test("multiple legacy active programs remain an actionable ambiguity", async () => {
  const f = fixture(); f.payments.push(payment("p1", "25000"));
  f.subs.push({ ...f.subs[0], id: "sub-b" });
  assert.equal((await f.sync("p1")).state, "AMBIGUOUS");
  assert.equal(f.active().length, 0);
});

test("metadata edit cannot change a competing program status", async () => {
  const f = fixture(); f.payments.push(payment("p1", "25000"));
  f.subs.push({ ...f.subs[0], id: "sub-b" });
  assert.equal((await f.sync("p1")).state, "AMBIGUOUS");
  await assert.rejects(() => updateSubscriptionRecord(f.tx, "member-a", "sub-b",
    { referenceNo: null, displayName: null, startDate: null, activeFlag: false, remark: null }, "admin"), /Status Program/);
  assert.equal(f.subs[1].activeFlag, true);
  assert.equal(f.balance(), "0.00");
});

test("deactivation with carry is rejected and never transfers an allocated partial payment", async () => {
  const f = fixture(); f.payments.push(payment("p1", "25000"));
  await f.sync("p1");
  f.subs.push({ ...f.subs[0], id: "sub-b", validUntil: null });
  await assert.rejects(() => updateSubscriptionRecord(f.tx, "member-a", "sub-a",
    { referenceNo: null, displayName: null, startDate: null, activeFlag: false, remark: null }, "admin"), /Status Program/);
  assert.equal(f.subs[0].activeFlag, true);
  assert.equal(f.balance("sub-a"), "25000.00");
  assert.equal(f.balance("sub-b"), "0.00");
  assert.equal(f.active().filter(row => row.entryType === "PAYMENT").length, 1);
});

test("sequential month-end extension and expired restart use the triggering payment", async () => {
  const f = fixture(); f.payments.push(payment("p1", "50000"), payment("p2", "50000", "2026-02-01"),
    payment("p3", "50000", "2026-07-01"));
  await f.sync("p1"); await f.sync("p2");
  assert.equal(f.subs[0].validUntil?.toISOString().slice(0, 10), "2026-03-27");
  await f.sync("p3");
  assert.equal(f.activeCoverage().find(row => row.bankTransactionId === "p3")?.coverageFrom.toISOString().slice(0, 10), "2026-07-01");
});

test("excluding the first partial payment rebuilds later payment into carry-only state", async () => {
  const f = fixture(); f.payments.push(payment("p1", "25000"), payment("p2", "25000", "2026-02-01"));
  await f.sync("p1"); await f.sync("p2");
  assert.equal(f.activeCoverage().length, 1);
  f.payments[0].reconciliationExcludedAt = new Date();
  await f.sync("p1");
  assert.equal(f.balance(), "25000.00");
  assert.equal(f.activeCoverage().length, 0);
  assert.equal(f.active().filter(row => row.entryType === "PAYMENT").length, 1);
  assert.ok(f.entries.some(row => row.bankTransactionId === "p1" && row.entryStatus === "VOIDED"));
});

test("approved principal correction recalculates carry; rejected proposal changes nothing", async () => {
  const f = fixture(); f.payments.push(payment("p1", "225000"));
  await f.sync("p1"); const before = f.entries.length;
  assert.equal(f.balance(), "25000.00");
  assert.equal(f.entries.length, before); // a rejected proposal does not call synchronization
  f.payments[0].baseAmount = d("75000"); f.payments[0].originalAmount = d("75000");
  await f.sync("p1", true);
  assert.equal(f.balance(), "25000.00");
  assert.equal(f.activeCoverage()[0].grantedUnits, 1);
  assert.equal(f.active().find(row => row.entryType === "PAYMENT")?.amountDelta.toFixed(2), "75000.00");
});

test("approved correction to a different Event Code voids old economic effect", async () => {
  const f = fixture(); f.payments.push(payment("p1", "225000"));
  await f.sync("p1");
  f.payments[0].eventCodeId = "other";
  f.payments[0].eventCode.id = "other";
  assert.equal((await f.sync("p1", true)).state, "ALLOCATED");
  assert.equal(f.balance("sub-a"), "0.00");
  assert.equal(f.activeCoverage("sub-a").length, 0);
  assert.ok(f.entries.filter(row => row.subscriptionId === "sub-a").every(row => row.entryStatus === "VOIDED"));
  const corrected = f.subs.find(row => row.eventCodeId === "other");
  assert.ok(corrected);
  assert.equal(f.active().filter(row => row.subscriptionId === corrected!.id && row.entryType === "PAYMENT").length, 1);
});

test("repeated explicit rebuild preserves active ledger identity and VOIDED audit count", async () => {
  const f = fixture(); f.payments.push(payment("p1", "225000"));
  await f.sync("p1");
  const before = f.entries.map(row => row.id);
  await rebuildTimeBasedSubscription(f.tx, "sub-a", "admin", "Recheck");
  await rebuildTimeBasedSubscription(f.tx, "sub-a", "admin", "Recheck");
  assert.deepEqual(f.entries.map(row => row.id), before);
});

test("broad rebuild refuses an active Carry Transfer relationship before it can void ledger rows", async () => {
  const f = fixture(); f.payments.push(payment("p1", "225000"));
  await f.sync("p1"); const before = f.entries.map(row => ({ id: row.id, status: row.entryStatus }));
  f.setActiveTransferRelation(true);
  await assert.rejects(() => rebuildTimeBasedSubscription(f.tx, "sub-a", "admin", "Recheck"), /Carry Transfer dependencies/);
  assert.deepEqual(f.entries.map(row => ({ id: row.id, status: row.entryStatus })), before);
});

test("Member move voids old economics and reuses VOIDED historical rate on new subscription", async () => {
  const f = fixture(); f.payments.push(payment("p1", "225000"));
  await f.sync("p1");
  f.subs.push({ ...f.subs[0], id: "sub-b", memberId: "member-b", validUntil: null });
  f.payments[0].memberIdentity.memberId = "member-b";
  f.payments[0].eventCode.timeRule.unitAmount = d("60000");
  await f.sync("p1");
  assert.equal(f.balance("sub-a"), "0.00");
  assert.equal(f.balance("sub-b"), "25000.00");
  assert.equal(f.active().find(row => row.subscriptionId === "sub-b" && row.entryType === "PAYMENT")?.unitAmountSnapshot?.toFixed(2), "50000.00");
});

test("manual allocation reuses historical snapshot and refuses duplicate active payment", async () => {
  const f = fixture(); f.payments.push(payment("p1", "225000"));
  await f.sync("p1");
  f.payments[0].memberIdentity.memberId = "member-b";
  f.subs.push({ ...f.subs[0], id: "sub-b", memberId: "member-b", validUntil: null },
    { ...f.subs[0], id: "sub-c", memberId: "member-b", validUntil: null });
  await f.sync("p1");
  const result = await manuallyAllocateTimeBasedPayment(f.tx, { memberId: "member-b", subscriptionId: "sub-b", transactionId: "p1", userId: "admin" });
  assert.equal(result.state, "ALLOCATED");
  assert.equal(f.balance("sub-b"), "25000.00");
  const before = f.entries.length;
  await manuallyAllocateTimeBasedPayment(f.tx, { memberId: "member-b", subscriptionId: "sub-b", transactionId: "p1", userId: "admin" });
  assert.equal(f.entries.length, before);
});

test("detach removes old allocation and keeps VOIDED snapshot for later re-link", async () => {
  const f = fixture(); f.payments.push(payment("p1", "25000"));
  await f.sync("p1");
  f.payments[0].memberIdentity.memberId = null;
  await reconcileTimeBasedCoverageForIdentity(f.tx, "identity", "admin");
  assert.equal(f.balance(), "0.00");
  assert.ok(f.entries.some(row => row.entryStatus === "VOIDED" && row.entryType === "PAYMENT"));
});

test("Opening coverage has no cash entry and rebuilds transaction validity", async () => {
  const f = fixture(); f.payments.push(payment("p1", "50000"));
  await f.sync("p1");
  const paymentCount = f.active().filter(row => row.entryType === "PAYMENT").length;
  await addOpeningCoverageRecord(f.tx, "member-a", "sub-a", { coverageFrom: "2026-02-28", coverageTo: "2026-03-31", remark: "Legacy" }, "admin");
  assert.equal(f.active().filter(row => row.entryType === "PAYMENT").length, paymentCount);
  assert.equal(f.active().filter(row => row.bankTransactionId === null).length, 0);
  assert.equal(f.subs[0].startDate?.toISOString().slice(0, 10), "2026-01-31");
});

test("opening coverage earlier than payment becomes the effective start and payment keeps its ledger date", async () => {
  const f = fixture();
  const first = payment("p1", "250000", "2026-09-01");
  first.eventCode.timeRule = { unitAmount: d("150000"), durationMonths: 3, activeFlag: true };
  f.payments.push(first);
  await addOpeningCoverageRecord(f.tx, "member-a", "sub-a", { coverageFrom: "2026-05-01", coverageTo: "2026-11-10", remark: "Legacy" }, "admin");
  await f.sync("p1");
  assert.equal(f.subs[0].startDate?.toISOString().slice(0, 10), "2026-05-01");
  assert.equal(f.active().find(row => row.entryType === "PAYMENT")?.effectiveDate.toISOString().slice(0, 10), "2026-09-01");
  assert.equal(f.activeCoverage()[0].coverageFrom.toISOString().slice(0, 10), "2026-11-11");
  assert.equal(f.activeCoverage()[0].coverageTo.toISOString().slice(0, 10), "2027-02-10");
});

test("opening coverage later than the first payment never moves the effective start forward", async () => {
  const f = fixture(); f.payments.push(payment("p1", "50000", "2026-05-01"));
  await f.sync("p1");
  await addOpeningCoverageRecord(f.tx, "member-a", "sub-a", { coverageFrom: "2026-08-01", coverageTo: "2026-08-31", remark: "Later evidence" }, "admin");
  assert.equal(f.subs[0].startDate?.toISOString().slice(0, 10), "2026-05-01");
});

test("system-managed start date remains stable while metadata can change", async () => {
  const f = fixture(); f.payments.push(payment("p1", "50000")); await f.sync("p1");
  await assert.rejects(() => updateSubscriptionRecord(f.tx, "member-a", "sub-a",
    { referenceNo: "R2", displayName: null, startDate: "2026-02-01", remark: null }, "admin"), /Start date cannot change/);
  await updateSubscriptionRecord(f.tx, "member-a", "sub-a",
    { referenceNo: "R2", displayName: null, remark: null }, "admin");
  assert.equal(f.subs[0].referenceNo, "R2");
});

test("historical PAYMENT snapshot requires same Event Code and unchanged principal", () => {
  const row = { entryType: "PAYMENT", amountDelta: d("25000"), unitAmountSnapshot: d("50000"),
    durationMonthsSnapshot: 1, subscription: { eventCodeId: "rupang" } };
  assert.equal(selectHistoricalPaymentSnapshot({ eventCodeId: "rupang", principalAmount: d("25000"), recalculate: false, entries: [row] })?.unitAmount, "50000");
  assert.equal(selectHistoricalPaymentSnapshot({ eventCodeId: "other", principalAmount: d("25000"), recalculate: false, entries: [row] }), null);
  assert.equal(selectHistoricalPaymentSnapshot({ eventCodeId: "rupang", principalAmount: d("75000"), recalculate: false, entries: [row] }), null);
  assert.equal(selectHistoricalPaymentSnapshot({ eventCodeId: "rupang", principalAmount: d("25004"), alternativePrincipalAmount: d("25000"), recalculate: false, entries: [row] })?.unitAmount, "50000");
  const full = { ...row, amountDelta: d("25004"), unitAmountSnapshot: d("60000") };
  assert.equal(selectHistoricalPaymentSnapshot({ eventCodeId: "rupang", principalAmount: d("25004"), alternativePrincipalAmount: d("25000"), recalculate: false, entries: [row, full] })?.unitAmount, "60000");
  assert.equal(selectHistoricalPaymentSnapshot({ eventCodeId: "rupang", principalAmount: d("25000"), recalculate: true, entries: [row] }), null);
});

test("Time Rule mutation blocks positive or negative carry and accepts zero", () => {
  const groups = (values: string[]) => values.map(value => ({ _sum: { amountDelta: d(value) } }));
  assert.throws(() => assertNoOutstandingTimeBasedCarry(groups(["25000"])), /carry balances/);
  assert.throws(() => assertNoOutstandingTimeBasedCarry(groups(["-100"])), /carry balances/);
  assert.doesNotThrow(() => assertNoOutstandingTimeBasedCarry(groups(["0"])));
});

test("Dashboard carry sums only positive active subscription groups", () => {
  assert.deepEqual(summarizeTimeBasedCarry([
    { _sum: { amountDelta: d("25000") } }, { _sum: { amountDelta: d("0") } },
    { _sum: { amountDelta: d("-10") } }
  ]), { outstandingCarryBalance: "25000.00", subscriptionsWithCarryBalance: 1 });
});

test("Dashboard carry query filters VOIDED rows before grouped aggregation", async () => {
  let where: unknown;
  const client = { memberEventBalanceLedger: { groupBy: async (input: { where: unknown }) => {
    where = input.where;
    return [{ subscriptionId: "sub-a", _sum: { amountDelta: d("25000") } }];
  } }, memberEventSubscription: { findMany: async () => [{ id: "sub-a", eventCode: { id: "rupang", code: "091", eventName: "Rupang" } }] } };
  assert.deepEqual(await loadDashboardTimeBasedCarry(client as never),
    { outstandingCarryBalance: "25000.00", subscriptionsWithCarryBalance: 1, carryByEvent: [{ eventCodeId: "rupang", code: "091", eventName: "Rupang", amount: "25000.00" }] });
  assert.deepEqual(where, { entryStatus: "ACTIVE" });
});

test("pending preview handles a partial payment with historical VOIDED rate", () => {
  const row = { ...payment("p1", "25000"), memberEventCoverages: [],
    memberEventBalanceLedger: [{ entryType: "PAYMENT", amountDelta: d("25000"),
      unitAmountSnapshot: d("50000"), durationMonthsSnapshot: 1, subscription: { eventCodeId: "rupang" } }] };
  row.eventCode.timeRule.unitAmount = d("60000");
  const preview = pendingTimeBasedPaymentPreview(row, []);
  assert.equal(preview.grantedUnits, 0);
  assert.equal(preview.unitAmount, "50000");
});

test("pending TIME_BASED preview uses full PAYMENT to resolve a unit at the suffix boundary", () => {
  const row = payment("p-suffix", "150004");
  row.baseAmount = d("149999");
  row.eventCode.timeRule.unitAmount = d("150000");
  const preview = pendingTimeBasedPaymentPreview({ ...row, memberEventCoverages: [], memberEventBalanceLedger: [] }, []);
  assert.equal(preview.principalAmount, "150004");
  assert.equal(preview.grantedUnits, 1);
});

test("Dashboard Time-Based counts exclude unfunded validUntil NULL", async () => {
  const today = day("2026-09-14");
  const rows = [null, day("2026-09-20"), day("2026-09-10")];
  const client = { memberEventSubscription: { count: async ({ where }: { where: { validUntil: { gte?: Date; lte?: Date; lt?: Date } } }) =>
    rows.filter(validUntil => validUntil !== null && (!where.validUntil.gte || validUntil >= where.validUntil.gte)
      && (!where.validUntil.lte || validUntil <= where.validUntil.lte) && (!where.validUntil.lt || validUntil < where.validUntil.lt)).length } };
  assert.deepEqual(await loadDashboardTimeBasedSummary(today, day("2026-10-14"), client as never),
    { activeSubscriptions: 1, expiringSoon: 1, expiredSubscriptions: 1 });
});

test("zero-carry subscription status is still system-managed after full payment", async () => {
  const f = fixture(); f.payments.push(payment("p1", "50000")); await f.sync("p1");
  const before = f.entries.length;
  await assert.rejects(() => updateSubscriptionRecord(f.tx, "member-a", "sub-a",
    { referenceNo: null, displayName: null, startDate: null, activeFlag: false, remark: null }, "admin"), /Status Program/);
  assert.equal(f.subs[0].activeFlag, true);
  assert.equal(f.balance(), "0.00");
  assert.equal(f.entries.length, before);
});

test("Opening void records reason, preserves history and rebuilds payment coverage and validUntil", async () => {
  const f = fixture(); f.payments.push(payment("p1", "50000", "2026-02-01"));
  await addOpeningCoverageRecord(f.tx, "member-a", "sub-a", { coverageFrom: "2026-01-01", coverageTo: "2026-03-31", remark: "Legacy opening" }, "admin");
  await f.sync("p1");
  assert.equal(f.activeCoverage()[0].coverageFrom.toISOString().slice(0, 10), "2026-04-01");
  const opening = f.coverages.find(row => row.coverageSource === "OPENING")!;
  const oldCoverage = f.activeCoverage()[0];
  await voidOpeningCoverageRecord(f.tx, "member-a", "sub-a", opening.id, "Wrong legacy interval", "admin");
  assert.equal(opening.coverageStatus, "VOIDED");
  assert.equal(opening.voidReason, "Wrong legacy interval");
  assert.equal(oldCoverage.coverageStatus, "VOIDED");
  assert.equal(f.activeCoverage()[0].coverageFrom.toISOString().slice(0, 10), "2026-02-01");
  assert.equal(f.subs[0].startDate?.toISOString().slice(0, 10), "2026-02-01");
  assert.equal(f.subs[0].validUntil?.toISOString().slice(0, 10), "2026-02-28");
  assert.equal(f.active().filter(row => row.entryType === "PAYMENT").length, 1);
  assert.equal(f.balance(), "0.00");
  await assert.rejects(() => voidOpeningCoverageRecord(f.tx, "member-a", "sub-a", opening.id, "Repeated request", "admin"), /no longer available/);
});

test("Opening void rejects missing reason, wrong owner and transaction coverage", async () => {
  const f = fixture(); f.payments.push(payment("p1", "50000")); await f.sync("p1");
  await addOpeningCoverageRecord(f.tx, "member-a", "sub-a", { coverageFrom: "2025-01-01", coverageTo: "2025-02-28", remark: "Legacy" }, "admin");
  const opening = f.coverages.find(row => row.coverageSource === "OPENING")!;
  await assert.rejects(() => voidOpeningCoverageRecord(f.tx, "member-a", "sub-a", opening.id, " ", "admin"), /reason/);
  await assert.rejects(() => voidOpeningCoverageRecord(f.tx, "member-b", "sub-a", opening.id, "Wrong owner", "admin"), /no longer available/);
  await assert.rejects(() => voidOpeningCoverageRecord(f.tx, "member-a", "sub-a", f.activeCoverage()[0].id, "Wrong source", "admin"), /no longer available/);
  assert.equal(opening.coverageStatus, "ACTIVE");
});

test("voiding sole Opening resets validUntil without generating cash entries", async () => {
  const f = fixture();
  await addOpeningCoverageRecord(f.tx, "member-a", "sub-a", { coverageFrom: "2026-01-01", coverageTo: "2026-03-31", remark: "Legacy" }, "admin");
  await voidOpeningCoverageRecord(f.tx, "member-a", "sub-a", f.coverages[0].id, "Incorrect opening", "admin");
  assert.equal(f.subs[0].validUntil, null);
  assert.equal(f.entries.length, 0);
});

test("Retry Allocation uses unique-subscription carry engine and is idempotent", async () => {
  const f = fixture(); f.payments.push(payment("p1", "25000"), payment("p2", "25000", "2026-02-01"));
  await retryAllocationRecord(f.tx, "member-a", "sub-a", "p1", "admin");
  assert.equal(f.balance(), "25000.00");
  await retryAllocationRecord(f.tx, "member-a", "sub-a", "p2", "admin");
  const entries = f.entries.length;
  await retryAllocationRecord(f.tx, "member-a", "sub-a", "p1", "admin");
  await retryAllocationRecord(f.tx, "member-a", "sub-a", "p2", "admin");
  assert.equal(f.entries.length, entries);
  assert.equal(f.active().filter(row => row.entryType === "PAYMENT").length, 2);
  assert.equal(f.balance(), "0.00");
  assert.equal(f.activeCoverage()[0].grantedUnits, 1);
});

test("Retry rejects zero/multiple subscriptions and ineligible ownership or lifecycle", async () => {
  const f = fixture(); f.payments.push(payment("p1", "25000"));
  f.subs[0].activeFlag = false;
  await assert.rejects(() => retryAllocationRecord(f.tx, "member-a", "sub-a", "p1", "admin"), /exactly one/);
  f.subs[0].activeFlag = true; f.subs.push({ ...f.subs[0], id: "sub-b" });
  await assert.rejects(() => retryAllocationRecord(f.tx, "member-a", "sub-a", "p1", "admin"), /exactly one/);
  f.subs.pop();
  await assert.rejects(() => retryAllocationRecord(f.tx, "member-b", "sub-a", "p1", "admin"), /official/);
  f.payments[0].status = "CHECK";
  await assert.rejects(() => retryAllocationRecord(f.tx, "member-a", "sub-a", "p1", "admin"), /official/);
  assert.equal(f.entries.length, 0);
});
