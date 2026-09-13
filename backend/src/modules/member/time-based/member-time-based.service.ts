import type { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { resolveTimeBasedUnits } from "../../reconciliation/time-based-classification.js";

type Tx = Prisma.TransactionClient;
const activeCoverage = { coverageStatus: "ACTIVE" } as const;

function utcDay(value: Date) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())); }
function addDays(value: Date, days: number) { const next = utcDay(value); next.setUTCDate(next.getUTCDate() + days); return next; }
function daysInMonth(year: number, month: number) { return new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); }

export function addCalendarMonthsInclusive(from: Date, months: number) {
  const start = utcDay(from);
  const targetIndex = start.getUTCFullYear() * 12 + start.getUTCMonth() + months;
  const year = Math.floor(targetIndex / 12);
  const month = targetIndex % 12;
  const endExclusive = new Date(Date.UTC(year, month, Math.min(start.getUTCDate(), daysInMonth(year, month))));
  return addDays(endExclusive, -1);
}

export function isCurrentTimeBasedAllocation(input: { subscriptionMemberId: string; subscriptionEventCodeId: string; paymentMemberId: string | null | undefined; paymentEventCodeId: string | null; verificationStatus: string | null | undefined }) {
  return input.subscriptionMemberId === input.paymentMemberId && input.subscriptionEventCodeId === input.paymentEventCodeId && input.verificationStatus === "VERIFIED";
}

export function historicalCoverageEntitlement(input: { eventCodeId: string; subscriptionEventCodeId: string; unitAmount: { toString(): string } | null; durationMonths: number | null; grantedUnits: number | null; amountApplied: { toString(): string } | null }) {
  if (input.eventCodeId !== input.subscriptionEventCodeId || !input.unitAmount || !input.durationMonths || !input.grantedUnits || !input.amountApplied) return null;
  return { unitAmount: input.unitAmount.toString(), durationMonths: input.durationMonths, grantedUnits: input.grantedUnits, amountApplied: input.amountApplied.toString() };
}

function isIncoming(transaction: { originalAmount: { toString(): string } }) { return !transaction.originalAmount.toString().startsWith("-"); }

async function refreshSubscriptionValidity(tx: Tx, subscriptionId: string) {
  const latest = await tx.memberEventCoverage.findFirst({ where: { subscriptionId, ...activeCoverage }, orderBy: [{ coverageTo: "desc" }, { id: "desc" }], select: { coverageTo: true } });
  await tx.memberEventSubscription.update({ where: { id: subscriptionId }, data: { validUntil: latest?.coverageTo ?? null } });
}

export function resolveCoverageStart(input: { latestCoverageTo: Date | null; startDate: Date | null; transactionDate: Date }) {
  if (input.latestCoverageTo) {
    if (utcDay(input.latestCoverageTo).getTime() >= utcDay(input.transactionDate).getTime()) return addDays(input.latestCoverageTo, 1);
    return utcDay(input.transactionDate);
  }
  return input.startDate ? utcDay(input.startDate) : utcDay(input.transactionDate);
}

async function coverageStart(tx: Tx, subscription: { id: string; startDate: Date | null }, transactionDate: Date) {
  const last = await tx.memberEventCoverage.findFirst({ where: { subscriptionId: subscription.id, ...activeCoverage }, orderBy: [{ coverageTo: "desc" }, { id: "desc" }], select: { coverageTo: true } });
  // The ledger is authoritative. Never reuse a denormalized/stale validUntil
  // after a chain has been voided or has expired.
  return resolveCoverageStart({ latestCoverageTo: last?.coverageTo ?? null, startDate: subscription.startDate, transactionDate });
}

async function voidActiveCoverageForTransaction(tx: Tx, transactionId: string, userId: string, reason: string) {
  const rows = await tx.memberEventCoverage.findMany({ where: { bankTransactionId: transactionId, ...activeCoverage }, select: { id: true, subscriptionId: true } });
  if (!rows.length) return [];
  await tx.memberEventCoverage.updateMany({ where: { id: { in: rows.map(row => row.id) }, ...activeCoverage }, data: { coverageStatus: "VOIDED", voidedAt: new Date(), voidedById: userId, voidReason: reason } });
  return [...new Set(rows.map(row => row.subscriptionId))];
}

async function rebuildSubscription(tx: Tx, subscriptionId: string, userId: string, reason: string) {
  const subscription = await tx.memberEventSubscription.findUnique({ where: { id: subscriptionId }, select: { id: true, memberId: true, eventCodeId: true, startDate: true } });
  if (!subscription) return;
  const rows = await tx.memberEventCoverage.findMany({
    where: { subscriptionId, coverageSource: "TRANSACTION", ...activeCoverage },
    include: { bankTransaction: { select: { id: true, transactionDate: true, originalAmount: true, baseAmount: true, status: true, reconciliationExcludedAt: true, eventCodeId: true, eventCode: { select: { eventType: true } }, memberIdentity: { select: { memberId: true, verificationStatus: true } } } } },
    orderBy: [{ bankTransaction: { transactionDate: "asc" } }, { bankTransactionId: "asc" }, { id: "asc" }]
  });
  if (!rows.length) { await refreshSubscriptionValidity(tx, subscriptionId); return; }
  await tx.memberEventCoverage.updateMany({ where: { id: { in: rows.map(row => row.id) }, ...activeCoverage }, data: { coverageStatus: "VOIDED", voidedAt: new Date(), voidedById: userId, voidReason: reason } });
  for (const row of rows) {
    const payment = row.bankTransaction;
    if (!payment || payment.status !== "FINALIZED" || payment.reconciliationExcludedAt || !isIncoming(payment)
      || payment.eventCodeId !== subscription.eventCodeId || payment.eventCode?.eventType !== "TIME_BASED"
      || payment.memberIdentity?.memberId !== subscription.memberId || payment.memberIdentity.verificationStatus !== "VERIFIED") continue;
    const from = await coverageStart(tx, subscription, payment.transactionDate ?? new Date());
    const months = (row.durationMonthsSnapshot ?? 0) * (row.grantedUnits ?? 0);
    if (months < 1) continue;
    await tx.memberEventCoverage.create({ data: {
      subscriptionId, bankTransactionId: payment.id, coverageSource: "TRANSACTION", coverageStatus: "ACTIVE",
      unitAmountSnapshot: row.unitAmountSnapshot, durationMonthsSnapshot: row.durationMonthsSnapshot, grantedUnits: row.grantedUnits,
      amountApplied: row.amountApplied, coverageFrom: from, coverageTo: addCalendarMonthsInclusive(from, months), remark: row.remark, createdById: userId
    } });
  }
  await refreshSubscriptionValidity(tx, subscriptionId);
}

/**
 * Keeps the coverage ledger aligned with an official transaction.  Snapshot
 * values deliberately win on ordinary re-syncs: changing a current Time Rule
 * must never rewrite entitlement that has already been granted.  Callers only
 * set recalculate when an approved correction changed that transaction.
 */
export async function synchronizeTimeBasedTransaction(tx: Tx, transactionId: string, userId: string, options?: { recalculate?: boolean }) {
  const payment = await tx.bankTransaction.findUnique({ where: { id: transactionId }, select: {
    id: true, transactionDate: true, originalAmount: true, baseAmount: true, status: true, reconciliationExcludedAt: true, eventCodeId: true,
    eventCode: { select: { id: true, eventType: true, timeRule: { select: { unitAmount: true, durationMonths: true, activeFlag: true } } } },
    memberIdentity: { select: { memberId: true, verificationStatus: true } }
  } });
  if (!payment) return { state: "MISSING" as const };
  const active = await tx.memberEventCoverage.findMany({ where: { bankTransactionId: transactionId, ...activeCoverage }, select: { id: true, subscriptionId: true, unitAmountSnapshot: true, durationMonthsSnapshot: true, grantedUnits: true, amountApplied: true, subscription: { select: { eventCodeId: true, memberId: true } } } });
  const sameOfficialAllocation = active.length === 1 && isCurrentTimeBasedAllocation({ subscriptionMemberId: active[0].subscription.memberId, subscriptionEventCodeId: active[0].subscription.eventCodeId, paymentMemberId: payment.memberIdentity?.memberId, paymentEventCodeId: payment.eventCodeId, verificationStatus: payment.memberIdentity?.verificationStatus });
  const historicalUnits = active.length === 1 && !options?.recalculate
    ? historicalCoverageEntitlement({ eventCodeId: payment.eventCodeId ?? "", subscriptionEventCodeId: active[0].subscription.eventCodeId, unitAmount: active[0].unitAmountSnapshot, durationMonths: active[0].durationMonthsSnapshot, grantedUnits: active[0].grantedUnits, amountApplied: active[0].amountApplied })
    : null;
  // A recorded snapshot is the historical source of truth. Do this before
  // consulting today's rule, which may no longer divide the old payment.
  if (sameOfficialAllocation && !options?.recalculate) return { state: "ALLOCATED" as const, subscriptionId: active[0].subscriptionId };
  let affected: string[] = [];
  if (active.length && !sameOfficialAllocation) {
    affected = await voidActiveCoverageForTransaction(tx, transactionId, userId, "Resolved Member or official classification changed");
    for (const subscriptionId of affected) await rebuildSubscription(tx, subscriptionId, userId, "Coverage chain rebuilt after allocation ownership changed");
  }
  const units = historicalUnits ?? (payment.transactionDate && payment.status === "FINALIZED" && !payment.reconciliationExcludedAt && isIncoming(payment)
    ? resolveTimeBasedUnits({ eventCode: payment.eventCode, rule: payment.eventCode?.timeRule ?? null, transaction: payment, requiresClassification: true }) : null);
  const sameOfficialEvent = active.length === 1 && active[0].subscription.eventCodeId === payment.eventCodeId;
  const unchanged = units && sameOfficialAllocation && sameOfficialEvent
    && active[0].unitAmountSnapshot?.toString() === units.unitAmount && active[0].durationMonthsSnapshot === units.durationMonths
    && active[0].grantedUnits === units.grantedUnits && active[0].amountApplied?.toString() === units.amountApplied;
  if (unchanged) return { state: "ALLOCATED" as const, subscriptionId: active[0].subscriptionId };

  if (active.length && affected.length === 0) {
    affected = await voidActiveCoverageForTransaction(tx, transactionId, userId, "Official transaction classification or amount changed");
    for (const subscriptionId of affected) await rebuildSubscription(tx, subscriptionId, userId, "Coverage chain rebuilt after official transaction change");
  }
  if (!units || payment.eventCode?.eventType !== "TIME_BASED") return { state: "NOT_TIME_BASED" as const };
  if (payment.memberIdentity?.verificationStatus !== "VERIFIED" || !payment.memberIdentity.memberId) return { state: "PENDING_MEMBER" as const };
  const subscriptions = await tx.memberEventSubscription.findMany({ where: { memberId: payment.memberIdentity.memberId, eventCodeId: payment.eventCode.id, activeFlag: true }, select: { id: true, memberId: true, eventCodeId: true, startDate: true } });
  if (subscriptions.length !== 1) return { state: subscriptions.length ? "AMBIGUOUS" as const : "PENDING_SUBSCRIPTION" as const };
  const subscription = subscriptions[0];
  const from = await coverageStart(tx, subscription, payment.transactionDate!);
  const to = addCalendarMonthsInclusive(from, units.durationMonths * units.grantedUnits);
  await tx.memberEventCoverage.create({ data: { subscriptionId: subscription.id, bankTransactionId: payment.id, coverageSource: "TRANSACTION", coverageStatus: "ACTIVE", unitAmountSnapshot: units.unitAmount, durationMonthsSnapshot: units.durationMonths, grantedUnits: units.grantedUnits, amountApplied: units.amountApplied, coverageFrom: from, coverageTo: to, createdById: userId } });
  await tx.memberEventSubscription.update({ where: { id: subscription.id }, data: { validUntil: to, updatedById: userId } });
  return { state: "ALLOCATED" as const, subscriptionId: subscription.id };
}

export async function synchronizePendingTimeBasedForMember(tx: Tx, memberId: string, userId: string, eventCodeId?: string) {
  const payments = await tx.bankTransaction.findMany({ where: { status: "FINALIZED", reconciliationExcludedAt: null, ...(eventCodeId ? { eventCodeId } : {}), eventCode: { is: { eventType: "TIME_BASED" } }, memberIdentity: { is: { memberId, verificationStatus: "VERIFIED" } } }, select: { id: true } });
  for (const payment of payments) await synchronizeTimeBasedTransaction(tx, payment.id, userId);
}

export async function reconcileTimeBasedCoverageForIdentity(tx: Tx, identityId: string, userId: string) {
  const payments = await tx.bankTransaction.findMany({ where: { status: "FINALIZED", memberIdentityId: identityId, OR: [{ eventCode: { is: { eventType: "TIME_BASED" } } }, { memberEventCoverages: { some: { coverageStatus: "ACTIVE" } } }] }, select: { id: true } });
  for (const payment of payments) await synchronizeTimeBasedTransaction(tx, payment.id, userId);
}

export async function rebuildTimeBasedSubscription(tx: Tx, subscriptionId: string, userId: string, reason: string) {
  await rebuildSubscription(tx, subscriptionId, userId, reason);
}

export async function manuallyAllocateTimeBasedPayment(tx: Tx, input: { memberId: string; subscriptionId: string; transactionId: string; userId: string }) {
  const subscription = await tx.memberEventSubscription.findUnique({ where: { id: input.subscriptionId }, select: { id: true, memberId: true, eventCodeId: true, activeFlag: true } });
  if (!subscription || subscription.memberId !== input.memberId || !subscription.activeFlag) throw new HttpError(400, "Choose an active subscription owned by this Member");
  const existing = await tx.memberEventCoverage.count({ where: { bankTransactionId: input.transactionId, ...activeCoverage } });
  if (existing) throw new HttpError(409, "This payment is already allocated to active coverage");
  const result = await synchronizeTimeBasedTransaction(tx, input.transactionId, input.userId);
  if (result.state === "ALLOCATED" && result.subscriptionId !== input.subscriptionId) throw new HttpError(409, "This payment was allocated while processing. Reload the Member detail.");
  if (result.state === "ALLOCATED") return result;

  const payment = await tx.bankTransaction.findUnique({ where: { id: input.transactionId }, select: { id: true, transactionDate: true, originalAmount: true, baseAmount: true, status: true, reconciliationExcludedAt: true, eventCodeId: true, eventCode: { select: { eventType: true, timeRule: { select: { unitAmount: true, durationMonths: true, activeFlag: true } } } }, memberIdentity: { select: { memberId: true, verificationStatus: true } } } });
  if (!payment || payment.status !== "FINALIZED" || payment.reconciliationExcludedAt || !isIncoming(payment) || payment.eventCodeId !== subscription.eventCodeId || payment.memberIdentity?.memberId !== input.memberId || payment.memberIdentity.verificationStatus !== "VERIFIED") throw new HttpError(400, "This finalized payment is not eligible for this subscription");
  const units = resolveTimeBasedUnits({ eventCode: payment.eventCode, rule: payment.eventCode?.timeRule ?? null, transaction: payment, requiresClassification: true });
  if (!units || !payment.transactionDate) throw new HttpError(400, "This payment has no Time-Based entitlement");
  const full = await tx.memberEventSubscription.findUniqueOrThrow({ where: { id: subscription.id }, select: { id: true, startDate: true } });
  const from = await coverageStart(tx, full, payment.transactionDate); const to = addCalendarMonthsInclusive(from, units.durationMonths * units.grantedUnits);
  await tx.memberEventCoverage.create({ data: { subscriptionId: subscription.id, bankTransactionId: payment.id, coverageSource: "TRANSACTION", coverageStatus: "ACTIVE", unitAmountSnapshot: units.unitAmount, durationMonthsSnapshot: units.durationMonths, grantedUnits: units.grantedUnits, amountApplied: units.amountApplied, coverageFrom: from, coverageTo: to, createdById: input.userId } });
  await tx.memberEventSubscription.update({ where: { id: subscription.id }, data: { validUntil: to, updatedById: input.userId } });
  return { state: "ALLOCATED" as const, subscriptionId: subscription.id };
}
