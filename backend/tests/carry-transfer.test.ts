import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { carryTransferCreateSchema, carryTransferHistoryQuerySchema, carryTransferReverseSchema } from "../src/modules/member/data/member-data.schema.js";
import { assertRebuildHasNoActiveTransferRelation, validateCarryTransferIntegrity } from "../src/modules/member/time-based/member-carry-transfer.foundation.js";
import { loadMemberCarryTransfers } from "../src/modules/member/time-based/member-carry-transfer.repository.js";
import { businessDayDateValue, forwardCarryTransferRecord, mapCarryTransferRow, resolveTransferCoverageStart, reverseCarryTransferRecord } from "../src/modules/member/time-based/member-carry-transfer.service.js";
import { addCalendarMonthsInclusive, rebuildTimeBasedSubscription, synchronizeTimeBasedTransaction } from "../src/modules/member/time-based/member-time-based.service.js";

const d = (value: string) => new Prisma.Decimal(value);
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
let keySequence = 0;
const nextKey = () => `key-${++keySequence}`;

type EventRow = { id: string; code: string; eventName: string; eventType: string; activeFlag: boolean;
  timeRule: { unitAmount: Prisma.Decimal; durationMonths: number; activeFlag: boolean } | null };
type SubRow = { id: string; memberId: string; eventCodeId: string; activeFlag: boolean;
  startDate: Date | null; validUntil: Date | null; referenceNo: string | null; displayName: string | null };
type EntryRow = { id: string; subscriptionId: string; bankTransactionId: string | null; coverageId: string | null;
  carryTransferId: string | null; entryType: string; entryStatus: string; amountDelta: Prisma.Decimal;
  effectiveDate: Date; postingSequence: bigint; unitAmountSnapshot: Prisma.Decimal | null;
  durationMonthsSnapshot: number | null; createdAt: Date; createdById: string | null; voidReason: string | null };
type CoverageRow = { id: string; subscriptionId: string; bankTransactionId: string | null; coverageSource: string;
  coverageStatus: string; unitAmountSnapshot: Prisma.Decimal | null; durationMonthsSnapshot: number | null;
  grantedUnits: number | null; amountApplied: Prisma.Decimal | null; coverageFrom: Date; coverageTo: Date;
  createdAt: Date; createdById: string | null; voidReason: string | null; remark: string | null };
type TransferRow = { id: string; memberId: string; sourceSubscriptionId: string; destinationSubscriptionId: string | null; destinationCampaignId: string | null;
  amount: Prisma.Decimal; effectiveDate: Date; reason: string; status: string; idempotencyKey: string;
  requestHash: string; reversalOfTransferId: string | null; destinationUnitAmountSnapshot: Prisma.Decimal;
  destinationDurationMonthsSnapshot: number; createdAt: Date; createdById: string; reversedAt: Date | null;
  reversedById: string | null };
type CampaignAllocationRow = { id: string; memberId: string; eventCampaignId: string; carryTransferId: string; amountDelta: Prisma.Decimal;
  allocationType: string; allocationStatus: string; effectiveDate: Date; reason: string; createdById: string; reversalOfAllocationId: string | null };
type PaymentRow = { id: string; transactionDate: Date; referenceNo: string | null; originalAmount: Prisma.Decimal;
  baseAmount: Prisma.Decimal; status: string; reconciliationExcludedAt: Date | null; eventCodeId: string;
  eventCode: { id: string; code: string; eventName: string; eventType: string; activeFlag: boolean;
    timeRule: { unitAmount: Prisma.Decimal; durationMonths: number; activeFlag: boolean } };
  memberIdentity: { memberId: string | null; verificationStatus: string } };

function fixture() {
  const members = [
    { id: "member-a", memberCode: "MBR-A", memberName: "Member A" },
    { id: "member-b", memberCode: "MBR-B", memberName: "Member B" }
  ];
  const events: EventRow[] = [
    { id: "event-004", code: "004", eventName: "Program 004", eventType: "TIME_BASED", activeFlag: true,
      timeRule: { unitAmount: d("100000.00"), durationMonths: 2, activeFlag: true } },
    { id: "event-005", code: "005", eventName: "Program 005", eventType: "TIME_BASED", activeFlag: true,
      timeRule: { unitAmount: d("100000.00"), durationMonths: 2, activeFlag: true } },
    { id: "event-standard", code: "091", eventName: "Rupang", eventType: "STANDARD", activeFlag: true, timeRule: null },
    { id: "event-campaign", code: "092", eventName: "Campaign", eventType: "CAMPAIGN", activeFlag: true, timeRule: null }
  ];
  const subs: SubRow[] = [
    { id: "sub-004", memberId: "member-a", eventCodeId: "event-004", activeFlag: true, startDate: null, validUntil: null, referenceNo: "004-A", displayName: null },
    { id: "sub-005", memberId: "member-a", eventCodeId: "event-005", activeFlag: true, startDate: null, validUntil: null, referenceNo: "005-A", displayName: null },
    { id: "sub-clean", memberId: "member-a", eventCodeId: "event-004", activeFlag: true, startDate: null, validUntil: null, referenceNo: "004-CLEAN", displayName: null },
    { id: "sub-other", memberId: "member-b", eventCodeId: "event-005", activeFlag: true, startDate: null, validUntil: null, referenceNo: "005-B", displayName: null }
  ];
  const campaigns = [{ id: "campaign-1", eventCodeId: "event-campaign", campaignName: "Campaign 2026", activeFlag: true,
    startDate: null as Date | null, endDate: null as Date | null, eventCode: { eventType: "CAMPAIGN", activeFlag: true } }];
  const entries: EntryRow[] = [];
  const coverages: CoverageRow[] = [];
  const transfers: TransferRow[] = [];
  const campaignAllocations: CampaignAllocationRow[] = [];
  const payments: PaymentRow[] = [];
  let paymentWrites = 0;
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-${String(++sequence).padStart(4, "0")}`;
  const unique = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
  const nextSequence = (subscriptionId: string) => entries.filter(row => row.subscriptionId === subscriptionId)
    .reduce((max, row) => row.postingSequence > max ? row.postingSequence : max, 0n) + 1n;
  const seedEntry = (subscriptionId: string, entryType: string, amount: string, date: string) => {
    entries.push({ id: nextId("ledger"), subscriptionId, bankTransactionId: null, coverageId: null, carryTransferId: null,
      entryType, entryStatus: "ACTIVE", amountDelta: d(amount), effectiveDate: day(date),
      postingSequence: nextSequence(subscriptionId), unitAmountSnapshot: null, durationMonthsSnapshot: null,
      createdAt: new Date(), createdById: "admin", voidReason: null });
  };
  const seedCarry = (subscriptionId: string, amount: string, date = "2026-01-01") => seedEntry(subscriptionId, "PAYMENT", amount, date);
  const seedConsumption = (subscriptionId: string, amount: string, date = "2026-02-01") => seedEntry(subscriptionId, "COVERAGE_USE", amount, date);
  const seedCoverage = (subscriptionId: string, coverageTo: string) => {
    coverages.push({ id: nextId("coverage"), subscriptionId, bankTransactionId: null, coverageSource: "TRANSACTION",
      coverageStatus: "ACTIVE", unitAmountSnapshot: d("100000.00"), durationMonthsSnapshot: 1, grantedUnits: 1,
      amountApplied: d("100000.00"), coverageFrom: day("2026-01-01"), coverageTo: day(coverageTo),
      createdAt: new Date(), createdById: "admin", voidReason: null, remark: null });
  };
  const seedPayment = (id: string, subscriptionId: string, eventCodeId: string, amount: string,
    memberId: string | null = "member-a", date = "2026-01-01") => {
    const event = events.find(row => row.id === eventCodeId)!;
    const rule = event.timeRule ?? { unitAmount: d("500000.00"), durationMonths: 1, activeFlag: true };
    payments.push({ id, transactionDate: day(date), referenceNo: id, originalAmount: d(amount), baseAmount: d(amount),
      status: "FINALIZED", reconciliationExcludedAt: null, eventCodeId,
      eventCode: { id: event.id, code: event.code, eventName: event.eventName, eventType: event.eventType,
        activeFlag: event.activeFlag, timeRule: rule },
      memberIdentity: { memberId, verificationStatus: "VERIFIED" } });
    entries.push({ id: nextId("ledger"), subscriptionId, bankTransactionId: id, coverageId: null, carryTransferId: null,
      entryType: "PAYMENT", entryStatus: "ACTIVE", amountDelta: d(amount), effectiveDate: day(date),
      postingSequence: nextSequence(subscriptionId), unitAmountSnapshot: d(rule.unitAmount.toString()),
      durationMonthsSnapshot: rule.durationMonths, createdAt: new Date(), createdById: "admin", voidReason: null });
  };
  const decorateEntry = (row: EntryRow) => ({ ...row,
    subscription: subs.find(sub => sub.id === row.subscriptionId) ?? null,
    coverage: row.coverageId ? coverages.find(cov => cov.id === row.coverageId) ?? null : null });
  const decorateCoverage = (row: CoverageRow) => ({ ...row, subscription: subs.find(sub => sub.id === row.subscriptionId) ?? null });
  const matches = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (value === null) return row[key] === null;
      if (typeof value === "object" && value !== null) {
        const operator = value as { gt?: bigint; lt?: bigint | number | Prisma.Decimal; lte?: bigint; in?: string[] };
        if ("in" in operator) return (operator.in ?? []).includes(String(row[key]));
        if (operator.gt !== undefined && typeof operator.gt === "bigint") return (row[key] as bigint) > operator.gt;
        if (operator.lte !== undefined) return (row[key] as bigint) <= operator.lte;
        if (operator.lt !== undefined && typeof operator.lt === "bigint") return (row[key] as bigint) < operator.lt;
        if (operator.lt !== undefined && typeof operator.lt === "number") return (row[key] as Prisma.Decimal).lessThan(operator.lt);
        return true;
      }
      return row[key] === value;
    });
  const tx = {
    member: { findUnique: async ({ where }: { where: { id: string } }) => members.find(row => row.id === where.id) ?? null },
    memberEventSubscription: {
      findUnique: async ({ where }: { where: { id: string } }) => { const row = subs.find(item => item.id === where.id); return row ? { ...row } : null; },
      findMany: async ({ where }: { where: { memberId?: string; eventCodeId?: string; activeFlag?: boolean } }) =>
        subs.filter(row => (where.memberId === undefined || row.memberId === where.memberId)
          && (where.eventCodeId === undefined || row.eventCodeId === where.eventCodeId)
          && (where.activeFlag === undefined || row.activeFlag === where.activeFlag)).map(row => ({ ...row })),
      update: async ({ where, data }: { where: { id: string }; data: Partial<SubRow> }) => {
        const row = subs.find(item => item.id === where.id)!; Object.assign(row, data); return { ...row };
      }
    },
    eventCode: { findUnique: async ({ where }: { where: { id: string } }) => { const row = events.find(item => item.id === where.id); return row ? { ...row } : null; } },
    eventCampaign: { findUnique: async ({ where }: { where: { id: string } }) => { const row = campaigns.find(item => item.id === where.id); return row ? { ...row } : null; } },
    memberEventBalanceLedger: {
      aggregate: async ({ where }: { where: Record<string, unknown> }) => {
        const rows = entries.filter(row => matches(row as unknown as Record<string, unknown>, where));
        return {
          _sum: { amountDelta: rows.reduce((sum, row) => sum.plus(row.amountDelta), d("0")) },
          _max: { postingSequence: rows.reduce<bigint | null>((max, row) => max === null || row.postingSequence > max ? row.postingSequence : max, null) }
        };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (entries.some(row => row.subscriptionId === data.subscriptionId && row.postingSequence === data.postingSequence)) throw unique();
        const row: EntryRow = {
          id: nextId("ledger"), subscriptionId: String(data.subscriptionId),
          bankTransactionId: (data.bankTransactionId as string | null) ?? null,
          coverageId: (data.coverageId as string | null) ?? null,
          carryTransferId: (data.carryTransferId as string | null) ?? null,
          entryType: String(data.entryType), entryStatus: String(data.entryStatus ?? "ACTIVE"),
          amountDelta: d(String(data.amountDelta)), effectiveDate: data.effectiveDate as Date,
          postingSequence: data.postingSequence as bigint,
          unitAmountSnapshot: data.unitAmountSnapshot ? d(String(data.unitAmountSnapshot)) : null,
          durationMonthsSnapshot: (data.durationMonthsSnapshot as number | undefined) ?? null,
          createdAt: new Date(), createdById: (data.createdById as string | undefined) ?? null, voidReason: null
        };
        entries.push(row); return decorateEntry(row);
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<EntryRow> }) => {
        const rows = entries.filter(item => matches(item as unknown as Record<string, unknown>, where));
        rows.forEach(row => Object.assign(row, data)); return { count: rows.length };
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const row = entries.find(item => matches(item as unknown as Record<string, unknown>, where));
        return row ? decorateEntry(row) : null;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        entries.filter(item => matches(item as unknown as Record<string, unknown>, where)).slice()
          .sort((a, b) => a.postingSequence < b.postingSequence ? -1 : 1).map(decorateEntry)
    },
    memberEventCoverage: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = coverages.find(item => item.id === where.id); return row ? { ...row } : null;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const row = coverages.filter(item => matches(item as unknown as Record<string, unknown>, where))
          .sort((a, b) => b.coverageTo.getTime() - a.coverageTo.getTime() || b.id.localeCompare(a.id))[0];
        return row ? decorateCoverage(row) : null;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        coverages.filter(row => matches(row as unknown as Record<string, unknown>, where)).map(decorateCoverage),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<CoverageRow> }) => {
        const rows = coverages.filter(row => matches(row as unknown as Record<string, unknown>, where));
        rows.forEach(row => Object.assign(row, data)); return { count: rows.length };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: CoverageRow = {
          id: nextId("coverage"), subscriptionId: String(data.subscriptionId),
          bankTransactionId: (data.bankTransactionId as string | null) ?? null,
          coverageSource: String(data.coverageSource), coverageStatus: String(data.coverageStatus),
          unitAmountSnapshot: data.unitAmountSnapshot ? d(String(data.unitAmountSnapshot)) : null,
          durationMonthsSnapshot: (data.durationMonthsSnapshot as number | undefined) ?? null,
          grantedUnits: (data.grantedUnits as number | undefined) ?? null,
          amountApplied: data.amountApplied ? d(String(data.amountApplied)) : null,
          coverageFrom: data.coverageFrom as Date, coverageTo: data.coverageTo as Date,
          createdAt: new Date(), createdById: (data.createdById as string | undefined) ?? null,
          voidReason: null, remark: (data.remark as string | undefined) ?? null
        };
        coverages.push(row); return decorateCoverage(row);
      }
    },
    memberEventCarryTransfer: {
      findUnique: async ({ where }: { where: { id?: string; idempotencyKey?: string } }) =>
        where.idempotencyKey !== undefined
          ? transfers.find(row => row.idempotencyKey === where.idempotencyKey) ?? null
          : transfers.find(row => row.id === where.id) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if (typeof where.reversalOfTransferId === "string")
          return transfers.find(row => row.reversalOfTransferId === where.reversalOfTransferId) ?? null;
        const clauses = (where.OR as Array<Record<string, string>> | undefined) ?? [];
        const decorated = (row: TransferRow) => ({ ...row,
          reversalOf: row.reversalOfTransferId ? transfers.find(item => item.id === row.reversalOfTransferId) ?? null : null });
        const scoped = transfers.filter(row => (!where.status || row.status === where.status)
          && clauses.some(clause => (clause.sourceSubscriptionId === undefined || row.sourceSubscriptionId === clause.sourceSubscriptionId)
            && (clause.destinationSubscriptionId === undefined || row.destinationSubscriptionId === clause.destinationSubscriptionId)));
        if (where.reversalOfTransferId === null) {
          const row = scoped.find(item => item.reversalOfTransferId === null);
          return row ? decorated(row) : null;
        }
        if (typeof where.reversalOfTransferId === "object" && where.reversalOfTransferId !== null) {
          const row = scoped.find(item => item.reversalOfTransferId !== null);
          return row ? decorated(row) : null;
        }
        const row = scoped[0];
        return row ? decorated(row) : null;
      },
      findMany: async ({ where }: { where: { id?: { in?: string[] } } }) => {
        const ids = where.id?.in ?? [];
        return transfers.filter(row => ids.includes(row.id)).map(row => ({ ...row }));
      },
      count: async ({ where }: { where?: { memberId?: string } }) => transfers.filter(row => !where?.memberId || row.memberId === where.memberId).length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (transfers.some(row => row.idempotencyKey === data.idempotencyKey)) throw unique();
        if (data.reversalOfTransferId && transfers.some(row => row.reversalOfTransferId === data.reversalOfTransferId)) throw unique();
        const row = {
          id: nextId("transfer"), status: "ACTIVE", reversalOfTransferId: null, reversedAt: null, reversedById: null,
          destinationDurationMonthsSnapshot: 0, createdAt: new Date(), ...data,
          amount: d(String(data.amount)),
          destinationUnitAmountSnapshot: d(String(data.destinationUnitAmountSnapshot)),
          effectiveDate: data.effectiveDate as Date
        } as unknown as TransferRow;
        transfers.push(row); return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<TransferRow> }) => {
        const row = transfers.find(item => item.id === where.id)!; Object.assign(row, data); return { ...row };
      }
    },
    memberEventCampaignAllocation: {
      findUnique: async ({ where }: { where: { carryTransferId: string } }) =>
        campaignAllocations.find(row => row.carryTransferId === where.carryTransferId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (campaignAllocations.some(row => row.carryTransferId === data.carryTransferId)) throw unique();
        const row: CampaignAllocationRow = { id: nextId("campaign-allocation"), allocationStatus: "ACTIVE",
          reversalOfAllocationId: null, ...data, amountDelta: d(String(data.amountDelta)),
          memberId: String(data.memberId), eventCampaignId: String(data.eventCampaignId), carryTransferId: String(data.carryTransferId),
          allocationType: String(data.allocationType), effectiveDate: data.effectiveDate as Date,
          reason: String(data.reason), createdById: String(data.createdById) } as CampaignAllocationRow;
        campaignAllocations.push(row); return { ...row };
      }
    },
    bankTransaction: {
      findUnique: async ({ where }: { where: { id: string } }) => payments.find(row => row.id === where.id) ?? null,
      findMany: async ({ where }: { where: { id?: { in?: string[] }; memberIdentityId?: string } }) =>
        payments.filter(row => (!where.id?.in || where.id.in.includes(row.id))
          && (where.memberIdentityId === undefined || row.memberIdentity.memberId === where.memberIdentityId))
          .map(row => ({ ...row })),
      update: async () => { paymentWrites += 1; throw new Error("Carry Transfer and rebuild must not update original financial records."); },
      updateMany: async () => { paymentWrites += 1; throw new Error("Carry Transfer and rebuild must not update original financial records."); },
      create: async () => { paymentWrites += 1; throw new Error("Carry Transfer and rebuild must not create financial records."); },
      delete: async () => { paymentWrites += 1; throw new Error("Carry Transfer and rebuild must not delete financial records."); },
      deleteMany: async () => { paymentWrites += 1; throw new Error("Carry Transfer and rebuild must not delete financial records."); }
    }
  } as unknown as Prisma.TransactionClient;
  return { tx, members, events, subs, campaigns, entries, coverages, transfers, campaignAllocations, payments,
    seedCarry, seedConsumption, seedCoverage, seedPayment, nextSequence,
    paymentWrites: () => paymentWrites };
}

type Fixture = ReturnType<typeof fixture>;
const setRule = (f: Fixture, eventCodeId: string, unitAmount: string, durationMonths: number, activeFlag = true) => {
  const event = f.events.find(row => row.id === eventCodeId);
  assert.ok(event, `missing event ${eventCodeId}`);
  event.timeRule = { unitAmount: d(unitAmount), durationMonths, activeFlag };
};
const forward = (f: Fixture, options: Partial<{ memberId: string; sourceSubscriptionId: string; destinationSubscriptionId: string; amount: string; reason: string; idempotencyKey: string }> = {}) =>
  forwardCarryTransferRecord(f.tx, {
    memberId: options.memberId ?? "member-a",
    sourceSubscriptionId: options.sourceSubscriptionId ?? "sub-004",
    destinationSubscriptionId: options.destinationSubscriptionId ?? "sub-005",
    amount: options.amount ?? "100000.00",
    reason: options.reason ?? "Member requested carry transfer",
    idempotencyKey: options.idempotencyKey ?? nextKey(),
    userId: "admin"
  });
const forwardCampaign = (f: Fixture, options: Partial<{ memberId: string; sourceSubscriptionId: string; destinationCampaignId: string; amount: string; reason: string; idempotencyKey: string }> = {}) =>
  forwardCarryTransferRecord(f.tx, { memberId: options.memberId ?? "member-a", sourceSubscriptionId: options.sourceSubscriptionId ?? "sub-004",
    destinationCampaignId: options.destinationCampaignId ?? "campaign-1", amount: options.amount ?? "100000.00",
    reason: options.reason ?? "Member requested Campaign allocation", idempotencyKey: options.idempotencyKey ?? nextKey(), userId: "admin" });
const reverse = (f: Fixture, transferId: string, options: Partial<{ memberId: string; reason: string; idempotencyKey: string }> = {}) =>
  reverseCarryTransferRecord(f.tx, {
    memberId: options.memberId ?? "member-a", transferId,
    reason: options.reason ?? "Reverse carry transfer",
    idempotencyKey: options.idempotencyKey ?? nextKey(), userId: "admin"
  });
const activeBalance = (f: Fixture, subscriptionId: string) => f.entries
  .filter(row => row.subscriptionId === subscriptionId && row.entryStatus === "ACTIVE")
  .reduce((sum, row) => sum.plus(row.amountDelta), d("0")).toFixed(2);

test("forward transfer moves all unused carry and allocates destination coverage", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  const result = await forward(f);
  assert.equal(f.transfers[0].status, "ACTIVE");
  assert.equal(result.source.carryBefore, "100000.00");
  assert.equal(result.source.carryAfter, "0.00");
  assert.equal(result.destination.carryBefore, "0.00");
  assert.equal(result.destination.carryAfter, "0.00");
  assert.equal(result.destination.allocation?.units, 1);
  const coverage = f.coverages.find(row => row.coverageSource === "TRANSFER")!;
  assert.equal(coverage.grantedUnits, 1);
  assert.equal(coverage.amountApplied?.toFixed(2), "100000.00");
  assert.equal(f.subs.find(row => row.id === "sub-005")!.validUntil?.getTime(), coverage.coverageTo.getTime());
});

test("partial transfer leaves the remainder as source carry", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  setRule(f, "event-005", "500000.00", 1);
  const result = await forward(f, { amount: "40000.00" });
  assert.equal(result.source.carryAfter, "60000.00");
  assert.equal(result.destination.carryAfter, "40000.00");
  assert.equal(result.destination.allocation?.units, 0);
  assert.equal(f.coverages.length, 0);
});

test("destination existing carry pools with the transfer before allocation", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00"); f.seedCarry("sub-005", "40000.00");
  const result = await forward(f);
  assert.equal(result.destination.carryBefore, "40000.00");
  assert.equal(result.destination.allocation?.units, 1);
  assert.equal(result.destination.carryAfter, "40000.00");
});

test("multiple destination units create the correct coverage duration and leave the remainder", async () => {
  const f = fixture(); f.seedCarry("sub-004", "250000.00"); setRule(f, "event-005", "100000.00", 1);
  const result = await forward(f, { amount: "250000.00" });
  assert.equal(result.destination.allocation?.units, 2);
  const coverage = f.coverages.find(row => row.coverageSource === "TRANSFER")!;
  assert.equal(coverage.durationMonthsSnapshot, 1);
  assert.equal(coverage.coverageTo.getTime(), addCalendarMonthsInclusive(businessDayDateValue(), 2).getTime());
  assert.equal(result.destination.carryAfter, "50000.00");
});

test("exact unit threshold creates coverage with no coverage leftover", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00"); setRule(f, "event-005", "100000.00", 1);
  const result = await forward(f);
  assert.equal(result.destination.allocation?.units, 1);
  assert.equal(result.destination.carryAfter, "0.00");
  assert.equal(f.coverages.filter(row => row.coverageSource === "TRANSFER").length, 1);
});

test("coverage remainder stays as carry when the pooled balance exceeds whole units", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00"); f.seedCarry("sub-005", "50000.00"); setRule(f, "event-005", "100000.00", 1);
  const result = await forward(f);
  assert.equal(result.destination.allocation?.units, 1);
  assert.equal(result.destination.carryAfter, "50000.00");
});

test("original source coverage is preserved", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00"); f.seedCoverage("sub-004", "2026-05-31");
  const before = { ...f.coverages[0], unitAmountSnapshot: f.coverages[0].unitAmountSnapshot?.toFixed(2) };
  await forward(f);
  assert.equal(f.coverages.filter(row => row.subscriptionId === "sub-004").length, 1);
  assert.deepEqual({ ...f.coverages[0], unitAmountSnapshot: f.coverages[0].unitAmountSnapshot?.toFixed(2) }, before);
});

test("transfer never touches original BankTransaction, donation, or Final Event records", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  await forward(f);
  assert.equal(f.transfers.length, 1);
  assert.equal(f.entries.filter(row => row.entryType === "TRANSFER_OUT").length, 1);
  assert.equal(f.entries.filter(row => row.entryType === "TRANSFER_IN").length, 1);
  assert.equal(f.paymentWrites(), 0);
  assert.equal(f.payments.length, 0);
});

test("transfer coverage starts after the latest active coverage when it extends beyond the transfer date", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00"); f.seedCoverage("sub-005", "2035-01-31");
  const result = await forward(f);
  assert.equal(result.destination.allocation?.coverage?.coverageFrom, "2035-02-01");
  const coverage = f.coverages.find(row => row.coverageSource === "TRANSFER")!;
  assert.equal(coverage.coverageFrom.toISOString().slice(0, 10), "2035-02-01");
});

test("coverage start never backdates before the transfer effective date", () => {
  const effective = day("2026-05-10");
  assert.equal(resolveTransferCoverageStart({ latestCoverageTo: null, effectiveDate: effective }).getTime(), effective.getTime());
  assert.equal(resolveTransferCoverageStart({ latestCoverageTo: day("2026-05-01"), effectiveDate: effective }).getTime(), effective.getTime());
  assert.equal(resolveTransferCoverageStart({ latestCoverageTo: day("2026-05-10"), effectiveDate: effective }).getTime(), day("2026-05-11").getTime());
});

test("transfer above live source carry is rejected", async () => {
  const f = fixture(); f.seedCarry("sub-004", "50000.00");
  await assert.rejects(() => forward(f, { amount: "60000.00" }), /enough unused carry/);
  assert.equal(f.transfers.length, 0);
});

test("zero and negative transfer amounts are rejected by service and schema", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  await assert.rejects(() => forward(f, { amount: "0.00" }), /greater than zero/);
  await assert.rejects(() => forward(f, { amount: "-1000.00" }), /greater than zero/);
  const base = { destinationSubscriptionId: "00000000-0000-0000-0000-000000000000", reason: "Valid reason", idempotencyKey: "key" };
  assert.equal(carryTransferCreateSchema.safeParse({ ...base, amount: "0.00" }).success, false);
  assert.equal(carryTransferCreateSchema.safeParse({ ...base, amount: "-1.00" }).success, false);
  assert.equal(carryTransferCreateSchema.safeParse({ ...base, amount: "not-an-amount" }).success, false);
  assert.equal(carryTransferCreateSchema.safeParse({ ...base, amount: "1000.00" }).success, true);
});

test("same source and destination subscription is rejected", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  await assert.rejects(() => forward(f, { destinationSubscriptionId: "sub-004" }), /must differ/);
});

test("different Member ownership is rejected for source and destination", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  await assert.rejects(() => forward(f, { destinationSubscriptionId: "sub-other" }), /Destination subscription was not found/);
  await assert.rejects(() => forward(f, { sourceSubscriptionId: "sub-other" }), /Source subscription was not found/);
});

test("inactive source and destination subscriptions are rejected", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  f.subs.find(row => row.id === "sub-004")!.activeFlag = false;
  await assert.rejects(() => forward(f), /source subscription is not active/);
  f.subs.find(row => row.id === "sub-004")!.activeFlag = true;
  f.subs.find(row => row.id === "sub-005")!.activeFlag = false;
  await assert.rejects(() => forward(f), /destination subscription is not active/);
});

test("STANDARD and CAMPAIGN destinations are rejected", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  f.subs.find(row => row.id === "sub-005")!.eventCodeId = "event-standard";
  await assert.rejects(() => forward(f), /must be a TIME_BASED Event Code/);
  f.subs.find(row => row.id === "sub-005")!.eventCodeId = "event-campaign";
  await assert.rejects(() => forward(f), /must be a TIME_BASED Event Code/);
});

test("missing or inactive destination Time Rule is rejected", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  setRule(f, "event-005", "100000.00", 2, false);
  await assert.rejects(() => forward(f), /active Time Rule/);
  f.events.find(row => row.id === "event-005")!.timeRule = null;
  await assert.rejects(() => forward(f), /active Time Rule/);
});

test("carry cannot be transferred from a payment that is not yet allocated", async () => {
  const f = fixture();
  await assert.rejects(() => forward(f, { amount: "1.00" }), /enough unused carry/);
  assert.equal(f.transfers.length, 0);
});

test("same idempotency key with the same payload returns the existing transfer", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  const key = nextKey();
  const first = await forward(f, { idempotencyKey: key });
  const second = await forward(f, { idempotencyKey: key });
  assert.deepEqual(second, first);
  assert.equal(f.transfers.length, 1);
});

test("same idempotency key with a different payload conflicts", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  const key = nextKey();
  await forward(f, { idempotencyKey: key });
  await assert.rejects(() => forward(f, { idempotencyKey: key, amount: "50000.00", reason: "Different request" }), /different Carry Transfer request/);
});

test("idempotent retry does not create duplicate ledger legs", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  const key = nextKey();
  await forward(f, { idempotencyKey: key });
  const legCount = f.entries.length;
  const transferCount = f.transfers.length;
  await forward(f, { idempotencyKey: key });
  assert.equal(f.entries.length, legCount);
  assert.equal(f.transfers.length, transferCount);
});

test("TIME_BASED to CAMPAIGN allocates full carry including suffix and records only allocation history", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100004.00");
  const paymentsBefore = f.payments.slice();
  const result = await forwardCampaign(f, { amount: "100004.00" });
  assert.equal(result.source.carryBefore, "100004.00");
  assert.equal(result.source.carryAfter, "0.00");
  assert.equal(result.destination.type, "CAMPAIGN");
  if (result.destination.type !== "CAMPAIGN") throw new Error("Expected Campaign destination");
  assert.equal(result.destination.campaignId, "campaign-1");
  assert.equal(result.destination.allocation.amountDelta, "100004.00");
  assert.equal(f.campaignAllocations.length, 1);
  assert.equal(f.campaignAllocations[0].allocationType, "CARRY_TRANSFER");
  assert.deepEqual(f.payments, paymentsBefore);
  assert.equal(f.paymentWrites(), 0);
});

test("partial TIME_BASED to CAMPAIGN allocation preserves every remaining rupiah", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100004.00");
  const result = await forwardCampaign(f, { amount: "55000.00" });
  assert.equal(result.source.carryAfter, "45004.00");
  assert.equal(result.destination.type, "CAMPAIGN");
  if (result.destination.type !== "CAMPAIGN") throw new Error("Expected Campaign destination");
  assert.equal(result.destination.allocation.amountDelta, "55000.00");
});

test("same Campaign transfer idempotency key returns an identical response without double posting", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100004.00");
  const key = nextKey();
  const first = await forwardCampaign(f, { amount: "100004.00", idempotencyKey: key });
  const second = await forwardCampaign(f, { amount: "100004.00", idempotencyKey: key });
  assert.deepEqual(second, first);
  assert.equal(f.transfers.length, 1);
  assert.equal(f.entries.filter(row => row.carryTransferId === first.transfer.transferId).length, 1);
  assert.equal(f.campaignAllocations.length, 1);
});

test("Campaign transfer rejects reuse of an idempotency key for a different request", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100004.00");
  const key = nextKey();
  await forwardCampaign(f, { amount: "50000.00", idempotencyKey: key });
  await assert.rejects(() => forwardCampaign(f, { amount: "50001.00", idempotencyKey: key }), /different Carry Transfer request/);
  assert.equal(f.campaignAllocations.length, 1);
});

test("Campaign reversal restores source carry and appends compensation without deleting forward history", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100004.00");
  const first = await forwardCampaign(f, { amount: "100004.00" });
  const result = await reverse(f, first.transfer.transferId);
  assert.equal(result.restoringDestination.carryAfter, "100004.00");
  assert.equal(result.restoringDestination.type, "TIME_BASED");
  assert.equal(result.reversingSource.type, "CAMPAIGN");
  if (result.reversingSource.type !== "CAMPAIGN") throw new Error("Expected Campaign reversal source");
  assert.equal(result.reversingSource.campaignId, "campaign-1");
  assert.equal(result.reversingSource.allocation.amountDelta, "-100004.00");
  assert.equal(f.transfers.length, 2);
  assert.equal(f.transfers.find(row => row.id === first.transfer.transferId)?.status, "REVERSED");
  assert.deepEqual(f.campaignAllocations.map(row => row.amountDelta.toFixed(2)), ["100004.00", "-100004.00"]);
  assert.equal(f.campaignAllocations[1].allocationType, "CARRY_REVERSAL");
  assert.equal(f.campaignAllocations[1].reversalOfAllocationId, f.campaignAllocations[0].id);
});

test("Campaign reversal idempotency replay is identical and double reversal is rejected", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100004.00");
  const first = await forwardCampaign(f, { amount: "100004.00" });
  const key = nextKey();
  const reversal = await reverse(f, first.transfer.transferId, { idempotencyKey: key });
  const replay = await reverse(f, first.transfer.transferId, { idempotencyKey: key });
  assert.deepEqual(replay, reversal);
  await assert.rejects(() => reverse(f, first.transfer.transferId), /already has a reversal/);
  assert.equal(f.campaignAllocations.length, 2);
});

test("TIME_BASED transfer replay after later activity preserves its original response snapshot", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  const key = nextKey();
  const first = await forward(f, { idempotencyKey: key });
  f.seedCarry("sub-004", "250.00", "2026-03-01");
  f.seedCarry("sub-005", "125.00", "2026-03-01");
  assert.deepEqual(await forward(f, { idempotencyKey: key }), first);
});

test("TIME_BASED reversal replay returns the same snapshot and prevents a second reversal", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00"); setRule(f, "event-005", "500000.00", 1);
  const first = await forward(f);
  const key = nextKey();
  const reversal = await reverse(f, first.transfer.transferId, { idempotencyKey: key });
  const replay = await reverse(f, first.transfer.transferId, { idempotencyKey: key });
  assert.deepEqual(replay, reversal);
  await assert.rejects(() => reverse(f, first.transfer.transferId), /already has a reversal/);
});

test("inactive, inactive-parent, and expired Campaign destinations are rejected", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100004.00");
  f.campaigns[0].activeFlag = false;
  await assert.rejects(() => forwardCampaign(f), /not active/);
  f.campaigns[0].activeFlag = true; f.campaigns[0].eventCode.activeFlag = false;
  await assert.rejects(() => forwardCampaign(f), /not active/);
  f.campaigns[0].eventCode.activeFlag = true; f.campaigns[0].endDate = day("2026-09-01");
  await assert.rejects(() => forwardCampaign(f), /outside its valid period/);
  assert.equal(f.transfers.length, 0);
});

test("a second transfer cannot double-spend the same source carry", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00"); setRule(f, "event-005", "500000.00", 1);
  await forward(f, { amount: "60000.00" });
  await assert.rejects(() => forward(f, { amount: "60000.00" }), /enough unused carry/);
  assert.equal(activeBalance(f, "sub-004"), "40000.00");
});

test("posting sequences stay unique per subscription across transfer activity", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00"); setRule(f, "event-005", "500000.00", 1);
  await forward(f, { amount: "30000.00" });
  await forward(f, { amount: "20000.00" });
  const bySubscription = new Map<string, bigint[]>();
  for (const entry of f.entries) bySubscription.set(entry.subscriptionId, [...(bySubscription.get(entry.subscriptionId) ?? []), entry.postingSequence]);
  for (const [subscriptionId, sequences] of bySubscription)
    assert.equal(new Set(sequences.map(String)).size, sequences.length, `duplicate posting sequence on ${subscriptionId}`);
});

test("an unused transfer reverses successfully and restores carry only", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00"); setRule(f, "event-005", "500000.00", 1);
  const first = await forward(f);
  const result = await reverse(f, first.transfer.transferId);
  assert.equal(f.transfers.find(row => row.id === first.transfer.transferId)?.status, "REVERSED");
  assert.equal(f.transfers.find(row => row.id === result.reversal.transferId)?.status, "ACTIVE");
  assert.equal(result.reversal.amount, "100000.00");
  assert.equal(result.restoringDestination.subscriptionId, "sub-004");
  assert.equal(result.restoringDestination.carryAfter, "100000.00");
  assert.equal(result.reversingSource.carryAfter, "0.00");
  assert.equal(f.transfers.length, 2);
});

test("reversal restores carry without creating any coverage", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00"); setRule(f, "event-005", "500000.00", 1);
  const first = await forward(f);
  await reverse(f, first.transfer.transferId);
  assert.equal(f.coverages.length, 0);
  assert.equal(f.entries.filter(row => row.entryType === "COVERAGE_USE").length, 0);
});

test("a second reversal of the same transfer is rejected", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00"); setRule(f, "event-005", "500000.00", 1);
  const first = await forward(f);
  await reverse(f, first.transfer.transferId);
  await assert.rejects(() => reverse(f, first.transfer.transferId), /already has a reversal/);
});

test("reversal amount is fixed to the original transfer amount", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00"); setRule(f, "event-005", "500000.00", 1);
  const first = await forward(f, { amount: "40000.00" });
  const result = await reverse(f, first.transfer.transferId);
  assert.equal(result.reversal.amount, "40000.00");
  const reversalLegs = f.entries.filter(row => row.carryTransferId === result.reversal.transferId);
  assert.deepEqual(reversalLegs.map(row => row.entryType).sort(), ["TRANSFER_IN", "TRANSFER_OUT"]);
  assert.equal(reversalLegs.find(row => row.entryType === "TRANSFER_OUT")!.amountDelta.toFixed(2), "-40000.00");
  assert.equal(reversalLegs.find(row => row.entryType === "TRANSFER_IN")!.amountDelta.toFixed(2), "40000.00");
  assert.equal(carryTransferReverseSchema.safeParse({ reason: "Valid reason", idempotencyKey: "key" }).success, true);
  assert.equal(carryTransferReverseSchema.safeParse({ reason: "Valid reason" }).success, false);
});

test("a later COVERAGE_USE blocks reversal even when current carry would cover it", async () => {
  const f = fixture(); f.seedCarry("sub-004", "50000.00"); f.seedCarry("sub-005", "100000.00");
  const first = await forward(f, { amount: "50000.00" });
  assert.equal(f.entries.some(row => row.subscriptionId === "sub-005" && row.entryType === "COVERAGE_USE"), true);
  assert.equal(activeBalance(f, "sub-005"), "50000.00");
  await assert.rejects(() => reverse(f, first.transfer.transferId), /Later balance actions depend/);
});

test("a later PAYMENT does not remove a prior COVERAGE_USE dependency", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00"); setRule(f, "event-005", "500000.00", 1);
  const first = await forward(f, { amount: "50000.00" });
  f.seedConsumption("sub-005", "-50000.00");
  f.seedCarry("sub-005", "50000.00", "2026-03-01");
  assert.equal(activeBalance(f, "sub-005"), "50000.00");
  await assert.rejects(() => reverse(f, first.transfer.transferId), /Later balance actions depend/);
});

test("an active downstream transfer blocks reversal of its parent", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  setRule(f, "event-005", "500000.00", 1); setRule(f, "event-004", "500000.00", 1);
  const first = await forward(f);
  await forward(f, { sourceSubscriptionId: "sub-005", destinationSubscriptionId: "sub-clean", amount: "100000.00" });
  await assert.rejects(() => reverse(f, first.transfer.transferId), /Unwind the downstream transfers first/);
});

test("reversing the downstream transfer first allows the parent reversal", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  setRule(f, "event-005", "500000.00", 1); setRule(f, "event-004", "500000.00", 1);
  const first = await forward(f);
  const downstream = await forward(f, { sourceSubscriptionId: "sub-005", destinationSubscriptionId: "sub-clean", amount: "100000.00" });
  await reverse(f, downstream.transfer.transferId);
  const parent = await reverse(f, first.transfer.transferId);
  assert.equal(f.transfers.find(row => row.id === first.transfer.transferId)?.status, "REVERSED");
  assert.equal(f.transfers.find(row => row.id === parent.reversal.transferId)?.status, "ACTIVE");
  assert.equal(activeBalance(f, "sub-004"), "100000.00");
  assert.equal(activeBalance(f, "sub-005"), "0.00");
  assert.equal(activeBalance(f, "sub-clean"), "0.00");
});

test("destination snapshots the current Time Rule at transfer time", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  const result = await forward(f);
  assert.equal(result.transfer.destinationRule.unitAmount, "100000.00");
  assert.equal(result.transfer.destinationRule.durationMonths, 2);
  const coverage = f.coverages.find(row => row.coverageSource === "TRANSFER")!;
  assert.equal(coverage.unitAmountSnapshot?.toFixed(2), "100000.00");
  assert.equal(coverage.durationMonthsSnapshot, 2);
  assert.equal(coverage.coverageFrom.getTime(), businessDayDateValue().getTime());
  assert.equal(coverage.coverageTo.getTime(), addCalendarMonthsInclusive(businessDayDateValue(), 2).getTime());
});

test("a later Time Rule change does not rewrite the transfer or coverage snapshot", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  await forward(f);
  const transfer = f.transfers[0];
  const coverage = f.coverages.find(row => row.coverageSource === "TRANSFER")!;
  const coverageTo = coverage.coverageTo.getTime();
  setRule(f, "event-005", "200000.00", 3);
  assert.equal(transfer.destinationUnitAmountSnapshot.toFixed(2), "100000.00");
  assert.equal(transfer.destinationDurationMonthsSnapshot, 2);
  assert.equal(coverage.unitAmountSnapshot?.toFixed(2), "100000.00");
  assert.equal(coverage.durationMonthsSnapshot, 2);
  assert.equal(coverage.coverageTo.getTime(), coverageTo);
});

test("active transfer relationships block unsafe rebuilds on both subscriptions", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00"); setRule(f, "event-005", "500000.00", 1);
  await forward(f);
  await assert.rejects(() => assertRebuildHasNoActiveTransferRelation(f.tx as never, "sub-004"), /Carry Transfer dependencies/);
  await assert.rejects(() => assertRebuildHasNoActiveTransferRelation(f.tx as never, "sub-005"), /Carry Transfer dependencies/);
  await assert.rejects(() => rebuildTimeBasedSubscription(f.tx as never, "sub-004", "admin", "Recheck"), /Carry Transfer dependencies/);
});

test("an unrelated subscription still rebuilds normally", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00"); setRule(f, "event-005", "500000.00", 1);
  await forward(f);
  await assert.doesNotReject(() => assertRebuildHasNoActiveTransferRelation(f.tx as never, "sub-clean"));
  await assert.doesNotReject(() => rebuildTimeBasedSubscription(f.tx as never, "sub-clean", "admin", "No transfer rebuild"));
});

test("existing no-transfer TIME_BASED behavior remains unchanged", async () => {
  const f = fixture();
  const before = f.entries.length;
  await rebuildTimeBasedSubscription(f.tx as never, "sub-clean", "admin", "Unrelated rebuild");
  assert.equal(f.entries.length, before);
  assert.equal(f.transfers.length, 0);
  assert.equal(f.coverages.length, 0);
});

const transferLegSnapshot = (f: Fixture) => f.entries
  .filter(row => row.entryType === "TRANSFER_IN" || row.entryType === "TRANSFER_OUT")
  .map(row => ({ id: row.id, subscriptionId: row.subscriptionId, carryTransferId: row.carryTransferId,
    entryType: row.entryType, entryStatus: row.entryStatus, amountDelta: row.amountDelta.toFixed(2),
    postingSequence: row.postingSequence }));
const transferHeaderSnapshot = (f: Fixture) => f.transfers.map(row => ({ id: row.id, status: row.status,
  reversalOfTransferId: row.reversalOfTransferId, idempotencyKey: row.idempotencyKey, requestHash: row.requestHash,
  amount: row.amount.toFixed(2), sourceSubscriptionId: row.sourceSubscriptionId,
  destinationSubscriptionId: row.destinationSubscriptionId, reversedAt: row.reversedAt, reversedById: row.reversedById }));
const assertTransferIntegrity = (f: Fixture) =>
  assert.deepEqual(validateCarryTransferIntegrity({ transfers: f.transfers, entries: f.entries, subscriptions: f.subs }), []);

async function unwoundTransfer() {
  const f = fixture();
  setRule(f, "event-004", "500000.00", 1); setRule(f, "event-005", "500000.00", 1);
  f.seedCarry("sub-004", "100000.00");
  const first = await forward(f);
  await reverse(f, first.transfer.transferId);
  return { f, first };
}

test("broad rebuild after a full unwind preserves transfer headers and ledger pairs", async () => {
  const { f } = await unwoundTransfer();
  const headersBefore = transferHeaderSnapshot(f);
  const legsBefore = transferLegSnapshot(f);
  await rebuildTimeBasedSubscription(f.tx as never, "sub-004", "admin", "Rebuild after transfer unwind");
  assert.deepEqual(transferHeaderSnapshot(f), headersBefore);
  assert.deepEqual(transferLegSnapshot(f), legsBefore);
  assert.equal(f.entries.find(row => row.entryType === "PAYMENT")!.entryStatus, "VOIDED");
  assert.equal(f.entries.filter(row => row.entryType === "TRANSFER_OUT" || row.entryType === "TRANSFER_IN").length, 4);
  assertTransferIntegrity(f);
});

test("reversed transfer history keeps both headers, both pairs, and stable posting sequences across repeated rebuilds", async () => {
  const { f, first } = await unwoundTransfer();
  const reversal = f.transfers.find(row => row.reversalOfTransferId === first.transfer.transferId)!;
  assert.equal(reversal.status, "ACTIVE");
  assert.equal(f.transfers.find(row => row.id === first.transfer.transferId)!.status, "REVERSED");
  const legsBefore = transferLegSnapshot(f);
  await rebuildTimeBasedSubscription(f.tx as never, "sub-004", "admin", "Rebuild once");
  await rebuildTimeBasedSubscription(f.tx as never, "sub-005", "admin", "Rebuild twice");
  await rebuildTimeBasedSubscription(f.tx as never, "sub-004", "admin", "Rebuild thrice");
  assert.equal(f.transfers.length, 2);
  assert.deepEqual(transferLegSnapshot(f), legsBefore);
  assert.equal(f.entries.filter(row => row.entryType === "TRANSFER_OUT" && row.entryStatus === "ACTIVE").length, 2);
  assert.equal(f.entries.filter(row => row.entryType === "TRANSFER_IN" && row.entryStatus === "ACTIVE").length, 2);
  assertTransferIntegrity(f);
});

test("integrity verifier stays clean after an allowed rebuild of transfer-touched subscriptions", async () => {
  const { f } = await unwoundTransfer();
  await rebuildTimeBasedSubscription(f.tx as never, "sub-004", "admin", "Allowed rebuild");
  assertTransferIntegrity(f);
});

test("source bank exclusion after a reversed transfer rebuilds bank economics only", async () => {
  const { f } = await unwoundTransfer();
  f.seedPayment("p1", "sub-004", "event-004", "100000.00");
  const legsBefore = transferLegSnapshot(f);
  const headersBefore = transferHeaderSnapshot(f);
  f.payments.find(row => row.id === "p1")!.reconciliationExcludedAt = new Date();
  const state = await synchronizeTimeBasedTransaction(f.tx, "p1", "admin");
  assert.notEqual(state.state, "ALLOCATED");
  assert.ok(f.entries.filter(row => row.bankTransactionId === "p1").every(row => row.entryStatus === "VOIDED"));
  assert.deepEqual(transferLegSnapshot(f), legsBefore);
  assert.deepEqual(transferHeaderSnapshot(f), headersBefore);
  assert.equal(f.payments.find(row => row.id === "p1")!.reconciliationExcludedAt instanceof Date, true);
  assertTransferIntegrity(f);
});

test("Event correction after a reversed transfer rebuilds payment economics without touching transfer history", async () => {
  const { f } = await unwoundTransfer();
  f.seedPayment("p1", "sub-004", "event-004", "100000.00");
  const legsBefore = transferLegSnapshot(f);
  const headersBefore = transferHeaderSnapshot(f);
  f.payments.find(row => row.id === "p1")!.eventCode.timeRule = { unitAmount: d("50000.00"), durationMonths: 1, activeFlag: true };
  setRule(f, "event-004", "50000.00", 1);
  const state = await synchronizeTimeBasedTransaction(f.tx, "p1", "admin", { recalculate: true });
  assert.equal(state.state, "ALLOCATED");
  assert.ok(f.coverages.some(row => row.subscriptionId === "sub-004" && row.coverageSource === "TRANSACTION" && row.coverageStatus === "ACTIVE"));
  assert.deepEqual(transferLegSnapshot(f), legsBefore);
  assert.deepEqual(transferHeaderSnapshot(f), headersBefore);
  assertTransferIntegrity(f);
});

test("identity Move after a reversed transfer preserves transfer history", async () => {
  const { f } = await unwoundTransfer();
  f.seedPayment("p1", "sub-004", "event-004", "100000.00");
  const legsBefore = transferLegSnapshot(f);
  const headersBefore = transferHeaderSnapshot(f);
  f.subs.push({ id: "sub-b-004", memberId: "member-b", eventCodeId: "event-004", activeFlag: true,
    startDate: null, validUntil: null, referenceNo: null, displayName: null });
  f.payments.find(row => row.id === "p1")!.memberIdentity.memberId = "member-b";
  const state = await synchronizeTimeBasedTransaction(f.tx, "p1", "admin");
  assert.equal(state.state, "ALLOCATED");
  assert.equal(state.subscriptionId, "sub-b-004");
  assert.ok(f.entries.filter(row => row.subscriptionId === "sub-004" && row.bankTransactionId === "p1").every(row => row.entryStatus === "VOIDED"));
  assert.deepEqual(transferLegSnapshot(f), legsBefore);
  assert.deepEqual(transferHeaderSnapshot(f), headersBefore);
  assertTransferIntegrity(f);
});

test("identity Detach after a reversed transfer preserves transfer history", async () => {
  const { f } = await unwoundTransfer();
  f.seedPayment("p1", "sub-004", "event-004", "100000.00");
  const legsBefore = transferLegSnapshot(f);
  const headersBefore = transferHeaderSnapshot(f);
  f.payments.find(row => row.id === "p1")!.memberIdentity.memberId = null;
  const state = await synchronizeTimeBasedTransaction(f.tx, "p1", "admin");
  assert.equal(state.state, "PENDING_MEMBER");
  assert.ok(f.entries.filter(row => row.bankTransactionId === "p1").every(row => row.entryStatus === "VOIDED"));
  assert.deepEqual(transferLegSnapshot(f), legsBefore);
  assert.deepEqual(transferHeaderSnapshot(f), headersBefore);
  assertTransferIntegrity(f);
});

test("Carry Transfer-generated coverage blocks broad rebuild defensively", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00");
  f.coverages.push({ id: "coverage-transfer-1", subscriptionId: "sub-004", bankTransactionId: null,
    coverageSource: "TRANSFER", coverageStatus: "ACTIVE", unitAmountSnapshot: d("100000.00"),
    durationMonthsSnapshot: 2, grantedUnits: 1, amountApplied: d("100000.00"), coverageFrom: day("2026-01-01"),
    coverageTo: day("2026-03-31"), createdAt: new Date(), createdById: "admin", voidReason: null, remark: null });
  f.entries.push({ id: "ledger-transfer-use", subscriptionId: "sub-004", bankTransactionId: null,
    coverageId: "coverage-transfer-1", carryTransferId: null, entryType: "COVERAGE_USE", entryStatus: "ACTIVE",
    amountDelta: d("-100000.00"), effectiveDate: day("2026-01-01"), postingSequence: f.nextSequence("sub-004"),
    unitAmountSnapshot: d("100000.00"), durationMonthsSnapshot: 2, createdAt: new Date(),
    createdById: "admin", voidReason: null });
  await assert.rejects(() => rebuildTimeBasedSubscription(f.tx as never, "sub-004", "admin", "Unsafe rebuild"),
    /Carry Transfer-generated coverage/);
  assert.equal(f.coverages[0].coverageStatus, "ACTIVE");
  assert.equal(f.entries.find(row => row.entryType === "COVERAGE_USE")!.entryStatus, "ACTIVE");
});

test("transfer history read is Member-scoped, paginated, and bounded", async () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    id: `transfer-${index}`, memberId: index % 5 === 0 ? "member-b" : "member-a",
    sourceSubscriptionId: "sub-004", destinationSubscriptionId: "sub-005",
    amount: d("100000.00"), effectiveDate: day("2026-01-31"), reason: "History", status: "ACTIVE",
    reversalOfTransferId: null, destinationUnitAmountSnapshot: d("100000.00"),
    destinationDurationMonthsSnapshot: 2, createdAt: new Date(),
    sourceSubscription: null, destinationSubscription: null,
    createdBy: null, reversedBy: null, reversalOf: null, reversal: null
  }));
  const memberRows = rows.filter(row => row.memberId === "member-a");
  let captured: { skip?: number; take?: number; where?: { memberId?: string } } = {};
  const client = {
    member: { findUnique: async ({ where }: { where: { id: string } }) => where.id === "member-a" ? { id: "member-a" } : null },
    memberEventCarryTransfer: {
      count: async ({ where }: { where: { memberId: string } }) => memberRows.filter(row => row.memberId === where.memberId).length,
      findMany: async (args: { skip: number; take: number; where: { memberId: string } }) => {
        captured = args;
        return memberRows.filter(row => row.memberId === args.where.memberId).slice(args.skip, args.skip + args.take);
      }
    }
  };
  const result = await loadMemberCarryTransfers(client as never, "member-a", 99, 10);
  assert.equal(result.total, 20);
  assert.equal(result.page, 2);
  assert.equal(captured.skip, 10);
  assert.equal(captured.take, 10);
  assert.equal(captured.where?.memberId, "member-a");
  const missing = await loadMemberCarryTransfers({
    member: { findUnique: async () => null },
    memberEventCarryTransfer: { count: async () => 0, findMany: async () => [] }
  } as never, "unknown", 1, 25);
  assert.equal(missing.member, null);
  assert.equal(carryTransferHistoryQuerySchema.parse({}).pageSize, 25);
  assert.equal(carryTransferHistoryQuerySchema.safeParse({ pageSize: 500 }).success, false);
});

test("transfer responses serialize decimals, dates, and relations safely", async () => {
  const f = fixture(); f.seedCarry("sub-004", "100000.00"); setRule(f, "event-005", "500000.00", 1);
  const result = await forward(f);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(typeof result.transfer.amount, "string");
  const view = mapCarryTransferRow({
    id: "transfer-1", status: "ACTIVE", amount: d("100000.00"), effectiveDate: day("2026-01-31"),
    reason: "History", createdAt: new Date("2026-01-31T03:00:00.000Z"),
    destinationUnitAmountSnapshot: d("100000.00"), destinationDurationMonthsSnapshot: 2,
    reversedAt: null, reversedBy: null,
    sourceSubscription: { id: "sub-004", referenceNo: "004", displayName: null, eventCode: { id: "event-004", code: "004", eventName: "Program 004" } },
    destinationSubscription: { id: "sub-005", referenceNo: "005", displayName: null, eventCode: { id: "event-005", code: "005", eventName: "Program 005" } },
    createdBy: { id: "admin", fullName: "Admin" },
    reversalOf: null, reversal: { id: "transfer-2", status: "ACTIVE", effectiveDate: day("2026-02-01") }
  } as never);
  assert.equal(view.amount, "100000.00");
  assert.equal(view.effectiveDate, "2026-01-31");
  assert.equal(view.destinationRule.unitAmount, "100000.00");
  assert.equal(view.source?.eventCode, "004");
  assert.equal(view.reversal?.effectiveDate, "2026-02-01");
  assert.doesNotThrow(() => JSON.stringify(view));
});

test("Carry Transfer routes require the existing Member mutation permission", () => {
  const routes = readFileSync(new URL("../src/modules/member/data/member-data.routes.ts", import.meta.url), "utf8");
  assert.match(routes, /post\("\/:memberId\/subscriptions\/:sourceSubscriptionId\/carry-transfers", requireMemberMutationAccess/);
  assert.match(routes, /post\("\/:memberId\/carry-transfers\/:transferId\/reverse", requireMemberMutationAccess/);
  assert.match(routes, /get\("\/:memberId\/carry-transfers", asyncHandler/);
});
