import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { decimalStringToCents } from "../../reconciliation/reconciliation-classification.js";
import { resolveTimeBasedUnits } from "../../reconciliation/time-based-classification.js";

type Tx = Prisma.TransactionClient;
const activeCoverage = { coverageStatus: "ACTIVE" } as const;
const activeEntry = { entryStatus: "ACTIVE" } as const;
const cents = (value: { toString(): string }) => decimalStringToCents(value.toString());
function money(value: bigint) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
function utcDay(value: Date) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())); }
function addDays(value: Date, days: number) { const next = utcDay(value); next.setUTCDate(next.getUTCDate() + days); return next; }
function daysInMonth(year: number, month: number) { return new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); }

export function calculateCarryGrant(priorBalance: bigint, paymentAmount: bigint, unitAmount: bigint) {
  if (priorBalance < 0n || paymentAmount <= 0n || unitAmount <= 0n) throw new HttpError(409, "Invalid TIME_BASED carry balance or payment");
  const available = priorBalance + paymentAmount;
  const units = available / unitAmount;
  if (units > BigInt(2_147_483_647)) throw new HttpError(400, "TIME_BASED payment grants too many units");
  const amountConsumed = units * unitAmount;
  return { grantedUnits: Number(units), amountConsumed, carryBalance: available - amountConsumed };
}

export function addCalendarMonthsInclusive(from: Date, months: number) {
  let nextStart = utcDay(from);
  for (let unit = 0; unit < months; unit += 1) {
    const targetIndex = nextStart.getUTCFullYear() * 12 + nextStart.getUTCMonth() + 1;
    const year = Math.floor(targetIndex / 12);
    const month = targetIndex % 12;
    nextStart = new Date(Date.UTC(year, month, Math.min(nextStart.getUTCDate(), daysInMonth(year, month))));
  }
  return addDays(nextStart, -1);
}

export function isCurrentTimeBasedAllocation(input: { subscriptionMemberId: string; subscriptionEventCodeId: string; paymentMemberId: string | null | undefined; paymentEventCodeId: string | null; verificationStatus: string | null | undefined }) {
  return input.subscriptionMemberId === input.paymentMemberId && input.subscriptionEventCodeId === input.paymentEventCodeId && input.verificationStatus === "VERIFIED";
}
export function historicalCoverageEntitlement(input: { eventCodeId: string; subscriptionEventCodeId: string; unitAmount: { toString(): string } | null; durationMonths: number | null; grantedUnits: number | null; amountApplied: { toString(): string } | null }) {
  if (input.eventCodeId !== input.subscriptionEventCodeId || !input.unitAmount || !input.durationMonths || !input.grantedUnits || !input.amountApplied) return null;
  return { unitAmount: input.unitAmount.toString(), durationMonths: input.durationMonths, grantedUnits: input.grantedUnits, amountApplied: input.amountApplied.toString() };
}
export function selectHistoricalCoverageEntitlement(input: {
  eventCodeId: string | null; principalAmount: { toString(): string }; recalculate: boolean;
  coverages: Array<{ coverageStatus: string; subscriptionEventCodeId: string; unitAmount: { toString(): string } | null;
    durationMonths: number | null; grantedUnits: number | null; amountApplied: { toString(): string } | null }>;
}) {
  if (!input.eventCodeId || input.recalculate) return null;
  const historical = input.coverages.find(row => row.subscriptionEventCodeId === input.eventCodeId
    && row.amountApplied && cents(row.amountApplied) === cents(input.principalAmount));
  return historical ? historicalCoverageEntitlement({ eventCodeId: input.eventCodeId,
    subscriptionEventCodeId: historical.subscriptionEventCodeId, unitAmount: historical.unitAmount,
    durationMonths: historical.durationMonths, grantedUnits: historical.grantedUnits,
    amountApplied: historical.amountApplied }) : null;
}
export function selectHistoricalPaymentSnapshot(input: {
  eventCodeId: string | null; principalAmount: { toString(): string }; recalculate: boolean;
  entries: Array<{ entryType: string; amountDelta: { toString(): string }; unitAmountSnapshot: { toString(): string } | null;
    durationMonthsSnapshot: number | null; subscription: { eventCodeId: string } }>;
}) {
  if (!input.eventCodeId || input.recalculate) return null;
  const row = input.entries.find(item => item.entryType === "PAYMENT" && item.subscription.eventCodeId === input.eventCodeId
    && cents(item.amountDelta) === cents(input.principalAmount) && item.unitAmountSnapshot && item.durationMonthsSnapshot);
  return row ? { unitAmount: row.unitAmountSnapshot!.toString(), durationMonths: row.durationMonthsSnapshot! } : null;
}
export function resolveCoverageStart(input: { latestCoverageTo: Date | null; startDate: Date | null; transactionDate: Date }) {
  if (input.latestCoverageTo) {
    if (utcDay(input.latestCoverageTo).getTime() >= utcDay(input.transactionDate).getTime()) return addDays(input.latestCoverageTo, 1);
    return utcDay(input.transactionDate);
  }
  return input.startDate ? utcDay(input.startDate) : utcDay(input.transactionDate);
}

const paymentSelect = {
  id: true, transactionDate: true, originalAmount: true, baseAmount: true, status: true,
  reconciliationExcludedAt: true, eventCodeId: true,
  eventCode: { select: { id: true, eventType: true, timeRule: { select: { unitAmount: true, durationMonths: true, activeFlag: true } } } },
  memberIdentity: { select: { memberId: true, verificationStatus: true } }
} as const;
type Payment = Prisma.BankTransactionGetPayload<{ select: typeof paymentSelect }>;
function eligible(payment: Payment, sub: { memberId: string; eventCodeId: string }) {
  return payment.status === "FINALIZED" && !payment.reconciliationExcludedAt && !!payment.transactionDate
    && !!payment.baseAmount && cents(payment.baseAmount) > 0n && cents(payment.originalAmount) > 0n
    && payment.eventCode?.eventType === "TIME_BASED"
    && isCurrentTimeBasedAllocation({ subscriptionMemberId: sub.memberId, subscriptionEventCodeId: sub.eventCodeId,
      paymentMemberId: payment.memberIdentity?.memberId, paymentEventCodeId: payment.eventCodeId,
      verificationStatus: payment.memberIdentity?.verificationStatus });
}
async function snapshot(tx: Tx, payment: Payment, recalculate: boolean) {
  if (!payment.baseAmount || !payment.eventCodeId) throw new HttpError(400, "TIME_BASED principal and Event Code are required");
  if (!recalculate) {
    const [entries, coverages] = await Promise.all([
      tx.memberEventBalanceLedger.findMany({ where: { bankTransactionId: payment.id, entryType: "PAYMENT" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { entryType: true, amountDelta: true, unitAmountSnapshot: true, durationMonthsSnapshot: true,
          subscription: { select: { eventCodeId: true } } } }),
      tx.memberEventCoverage.findMany({ where: { bankTransactionId: payment.id, coverageSource: "TRANSACTION" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { coverageStatus: true, unitAmountSnapshot: true, durationMonthsSnapshot: true,
          grantedUnits: true, amountApplied: true, subscription: { select: { eventCodeId: true } } } })
    ]);
    const old = selectHistoricalPaymentSnapshot({ eventCodeId: payment.eventCodeId,
      principalAmount: payment.baseAmount, recalculate: false, entries })
      ?? selectHistoricalCoverageEntitlement({ eventCodeId: payment.eventCodeId,
        principalAmount: payment.baseAmount, recalculate: false,
        coverages: coverages.map(row => ({ coverageStatus: row.coverageStatus,
          subscriptionEventCodeId: row.subscription.eventCodeId, unitAmount: row.unitAmountSnapshot,
          durationMonths: row.durationMonthsSnapshot, grantedUnits: row.grantedUnits, amountApplied: row.amountApplied })) });
    if (old) return old;
  }
  const current = resolveTimeBasedUnits({ eventCode: payment.eventCode, rule: payment.eventCode?.timeRule ?? null,
    transaction: payment, requiresClassification: true });
  if (!current) throw new HttpError(400, "This payment has no TIME_BASED rule");
  return { unitAmount: current.unitAmount, durationMonths: current.durationMonths };
}
async function refreshValidity(tx: Tx, subscriptionId: string) {
  const latest = await tx.memberEventCoverage.findFirst({ where: { subscriptionId, ...activeCoverage },
    orderBy: [{ coverageTo: "desc" }, { id: "desc" }], select: { coverageTo: true } });
  await tx.memberEventSubscription.update({ where: { id: subscriptionId }, data: { validUntil: latest?.coverageTo ?? null } });
}
async function rebuildSubscription(tx: Tx, subscriptionId: string, userId: string, reason: string,
  addition?: { payment: Payment; recalculate: boolean }) {
  const sub = await tx.memberEventSubscription.findUnique({ where: { id: subscriptionId },
    select: { id: true, memberId: true, eventCodeId: true, startDate: true, validUntil: true } });
  if (!sub) return;
  const [ledger, coverage, openings, activeLedger] = await Promise.all([
    tx.memberEventBalanceLedger.findMany({ where: { subscriptionId, entryType: "PAYMENT", ...activeEntry },
      select: { bankTransactionId: true, amountDelta: true, unitAmountSnapshot: true, durationMonthsSnapshot: true, effectiveDate: true } }),
    tx.memberEventCoverage.findMany({ where: { subscriptionId, coverageSource: "TRANSACTION", ...activeCoverage },
      select: { bankTransactionId: true, coverageFrom: true, coverageTo: true, unitAmountSnapshot: true,
        durationMonthsSnapshot: true, grantedUnits: true, amountApplied: true } }),
    tx.memberEventCoverage.findMany({ where: { subscriptionId, coverageSource: "OPENING", ...activeCoverage },
      select: { coverageTo: true }, orderBy: [{ coverageTo: "desc" }, { id: "desc" }] }),
    tx.memberEventBalanceLedger.findMany({ where: { subscriptionId, entryType: "COVERAGE_USE", ...activeEntry },
      select: { bankTransactionId: true, amountDelta: true } })
  ]);
  const ids = [...new Set([...ledger, ...coverage].flatMap(row => row.bankTransactionId ? [row.bankTransactionId] : []))];
  if (addition && !ids.includes(addition.payment.id)) ids.push(addition.payment.id);
  const payments = ids.length ? await tx.bankTransaction.findMany({ where: { id: { in: ids } }, select: paymentSelect }) : [];
  if (addition && !payments.some(row => row.id === addition.payment.id)) payments.push(addition.payment);
  const surviving = payments.filter(row => eligible(row, sub)).sort((a, b) =>
    a.transactionDate!.getTime() - b.transactionDate!.getTime() || a.id.localeCompare(b.id));
  const snapshots = await Promise.all(surviving.map(row => snapshot(tx, row, addition?.payment.id === row.id && addition.recalculate)));
  let balance = 0n;
  let lastCoverageTo = openings[0]?.coverageTo ?? null;
  const plan = surviving.map((payment, index) => {
    const rate = snapshots[index];
    const amount = cents(payment.baseAmount!);
    const grant = calculateCarryGrant(balance, amount, decimalStringToCents(rate.unitAmount));
    const months = grant.grantedUnits * rate.durationMonths;
    if (!Number.isSafeInteger(months)) throw new HttpError(400, "TIME_BASED coverage duration is too large");
    const from = months ? resolveCoverageStart({ latestCoverageTo: lastCoverageTo,
      startDate: sub.startDate, transactionDate: payment.transactionDate! }) : null;
    const to = from ? addCalendarMonthsInclusive(from, months) : null;
    if (to) lastCoverageTo = to;
    balance = grant.carryBalance;
    return { payment, rate, amount, grant, from, to };
  });
  const sameDate = (a: Date | null, b: Date | null) => a?.getTime() === b?.getTime();
  const unchanged = ledger.length === plan.length
    && coverage.length === plan.filter(row => row.from).length
    && activeLedger.length === coverage.length
    && sameDate(sub.validUntil, lastCoverageTo)
    && plan.every(row => {
      const entry = ledger.find(item => item.bankTransactionId === row.payment.id);
      const cov = coverage.find(item => item.bankTransactionId === row.payment.id);
      const use = activeLedger.find(item => item.bankTransactionId === row.payment.id);
      return entry && cents(entry.amountDelta) === row.amount
        && entry.unitAmountSnapshot?.toString() === row.rate.unitAmount
        && entry.durationMonthsSnapshot === row.rate.durationMonths
        && sameDate(entry.effectiveDate, row.payment.transactionDate)
        && (row.from ? cov && use && sameDate(cov.coverageFrom, row.from) && sameDate(cov.coverageTo, row.to)
          && cov.grantedUnits === row.grant.grantedUnits && cov.durationMonthsSnapshot === row.rate.durationMonths
          && cov.unitAmountSnapshot?.toString() === row.rate.unitAmount
          && cov.amountApplied && cents(cov.amountApplied) === row.grant.amountConsumed
          && cents(use.amountDelta) === -row.grant.amountConsumed : !cov && !use);
    });
  if (unchanged) return;
  const now = new Date();
  await tx.memberEventBalanceLedger.updateMany({ where: { subscriptionId, ...activeEntry },
    data: { entryStatus: "VOIDED", voidedAt: now, voidedById: userId, voidReason: reason } });
  await tx.memberEventCoverage.updateMany({ where: { subscriptionId, coverageSource: "TRANSACTION", ...activeCoverage },
    data: { coverageStatus: "VOIDED", voidedAt: now, voidedById: userId, voidReason: reason } });
  for (const { payment, rate, amount, grant, from, to } of plan) {
    const date = payment.transactionDate!;
    await tx.memberEventBalanceLedger.create({ data: {
      subscriptionId, bankTransactionId: payment.id, entryType: "PAYMENT", entryStatus: "ACTIVE",
      amountDelta: money(amount), effectiveDate: date, unitAmountSnapshot: rate.unitAmount,
      durationMonthsSnapshot: rate.durationMonths, createdById: userId
    } });
    if (from && to) {
      const created = await tx.memberEventCoverage.create({ data: {
        subscriptionId, bankTransactionId: payment.id, coverageSource: "TRANSACTION", coverageStatus: "ACTIVE",
        unitAmountSnapshot: rate.unitAmount, durationMonthsSnapshot: rate.durationMonths,
        grantedUnits: grant.grantedUnits, amountApplied: money(grant.amountConsumed),
        coverageFrom: from, coverageTo: to, createdById: userId
      } });
      await tx.memberEventBalanceLedger.create({ data: {
        subscriptionId, bankTransactionId: payment.id, coverageId: created.id,
        entryType: "COVERAGE_USE", entryStatus: "ACTIVE", amountDelta: money(-grant.amountConsumed),
        effectiveDate: date, unitAmountSnapshot: rate.unitAmount,
        durationMonthsSnapshot: rate.durationMonths, createdById: userId
      } });
    }
  }
  await refreshValidity(tx, subscriptionId);
}

/** Runs inside the caller's serializable transaction. ACTIVE PAYMENT proves allocation even with zero coverage. */
export async function synchronizeTimeBasedTransaction(tx: Tx, transactionId: string, userId: string,
  options?: { recalculate?: boolean; subscriptionId?: string }) {
  const payment = await tx.bankTransaction.findUnique({ where: { id: transactionId }, select: paymentSelect });
  if (!payment) return { state: "MISSING" as const };
  const [activePayments, legacyCoverage] = await Promise.all([
    tx.memberEventBalanceLedger.findMany({ where: { bankTransactionId: transactionId, entryType: "PAYMENT", ...activeEntry },
      select: { subscriptionId: true, amountDelta: true, unitAmountSnapshot: true, durationMonthsSnapshot: true,
        subscription: { select: { memberId: true, eventCodeId: true } } } }),
    tx.memberEventCoverage.findMany({ where: { bankTransactionId: transactionId, coverageSource: "TRANSACTION", ...activeCoverage },
      select: { subscriptionId: true, subscription: { select: { memberId: true, eventCodeId: true } } } })
  ]);
  const oldIds = [...new Set([...activePayments, ...legacyCoverage].map(row => row.subscriptionId))];
  const memberId = payment.memberIdentity?.verificationStatus === "VERIFIED" ? payment.memberIdentity.memberId : null;
  const official = payment.status === "FINALIZED" && !payment.reconciliationExcludedAt
    && payment.eventCode?.eventType === "TIME_BASED" && !!payment.transactionDate
    && !!payment.baseAmount && cents(payment.baseAmount) > 0n && cents(payment.originalAmount) > 0n;
  let destination: string | null = null;
  let pending: "PENDING_MEMBER" | "PENDING_SUBSCRIPTION" | "AMBIGUOUS" | "NOT_TIME_BASED" = "NOT_TIME_BASED";
  const pinned = official ? [...activePayments, ...legacyCoverage].find(row =>
    isCurrentTimeBasedAllocation({ subscriptionMemberId: row.subscription.memberId,
      subscriptionEventCodeId: row.subscription.eventCodeId, paymentMemberId: memberId,
      paymentEventCodeId: payment.eventCodeId, verificationStatus: payment.memberIdentity?.verificationStatus })) : null;
  if (official) {
    if (!memberId) pending = "PENDING_MEMBER";
    else if (options?.subscriptionId) {
      if (pinned && pinned.subscriptionId !== options.subscriptionId)
        throw new HttpError(409, "This payment is already allocated to another subscription");
      const chosen = await tx.memberEventSubscription.findUnique({ where: { id: options.subscriptionId },
        select: { id: true, memberId: true, eventCodeId: true, activeFlag: true } });
      if (!chosen || !chosen.activeFlag || !eligible(payment, chosen))
        throw new HttpError(400, "This finalized payment is not eligible for this subscription");
      destination = chosen.id;
    } else if (pinned) {
      // Deactivating a subscription never transfers an existing payment.
      destination = pinned.subscriptionId;
    } else {
      const matches = await tx.memberEventSubscription.findMany({ where: { memberId,
        eventCodeId: payment.eventCodeId!, activeFlag: true }, select: { id: true } });
      if (matches.length === 1) destination = matches[0].id;
      else pending = matches.length ? "AMBIGUOUS" : "PENDING_SUBSCRIPTION";
    }
  }
  const active = activePayments.length === 1 ? activePayments[0] : null;
  if (destination && active && active.subscriptionId === destination && oldIds.length === 1
    && !options?.recalculate && active.unitAmountSnapshot && active.durationMonthsSnapshot
    && cents(active.amountDelta) === cents(payment.baseAmount!)
    && isCurrentTimeBasedAllocation({ subscriptionMemberId: active.subscription.memberId,
      subscriptionEventCodeId: active.subscription.eventCodeId, paymentMemberId: memberId,
      paymentEventCodeId: payment.eventCodeId, verificationStatus: payment.memberIdentity?.verificationStatus }))
    return { state: "ALLOCATED" as const, subscriptionId: destination };
  for (const oldId of oldIds.filter(id => id !== destination))
    await rebuildSubscription(tx, oldId, userId, "Official allocation or Member ownership changed");
  if (destination) {
    await rebuildSubscription(tx, destination, userId, "Official TIME_BASED payment allocation rebuilt",
      { payment, recalculate: options?.recalculate ?? false });
    return { state: "ALLOCATED" as const, subscriptionId: destination };
  }
  return { state: pending };
}
export async function synchronizePendingTimeBasedForMember(tx: Tx, memberId: string, userId: string, eventCodeId?: string) {
  const payments = await tx.bankTransaction.findMany({ where: { status: "FINALIZED", reconciliationExcludedAt: null,
    ...(eventCodeId ? { eventCodeId } : {}), eventCode: { is: { eventType: "TIME_BASED" } },
    memberIdentity: { is: { memberId, verificationStatus: "VERIFIED" } } },
    select: { id: true }, orderBy: [{ transactionDate: "asc" }, { id: "asc" }] });
  for (const payment of payments) await synchronizeTimeBasedTransaction(tx, payment.id, userId);
}
export async function reconcileTimeBasedCoverageForIdentity(tx: Tx, identityId: string, userId: string) {
  const payments = await tx.bankTransaction.findMany({ where: { status: "FINALIZED", memberIdentityId: identityId,
    OR: [{ eventCode: { is: { eventType: "TIME_BASED" } } },
      { memberEventBalanceLedger: { some: { entryType: "PAYMENT", entryStatus: "ACTIVE" } } },
      { memberEventCoverages: { some: { coverageStatus: "ACTIVE", coverageSource: "TRANSACTION" } } }] },
    select: { id: true }, orderBy: [{ transactionDate: "asc" }, { id: "asc" }] });
  for (const payment of payments) await synchronizeTimeBasedTransaction(tx, payment.id, userId);
}
export async function rebuildTimeBasedSubscription(tx: Tx, subscriptionId: string, userId: string, reason: string) {
  await rebuildSubscription(tx, subscriptionId, userId, reason);
}
export async function manuallyAllocateTimeBasedPayment(tx: Tx,
  input: { memberId: string; subscriptionId: string; transactionId: string; userId: string }) {
  const sub = await tx.memberEventSubscription.findUnique({ where: { id: input.subscriptionId },
    select: { memberId: true, activeFlag: true } });
  if (!sub || sub.memberId !== input.memberId || !sub.activeFlag)
    throw new HttpError(400, "Choose an active subscription owned by this Member");
  const result = await synchronizeTimeBasedTransaction(tx, input.transactionId, input.userId,
    { subscriptionId: input.subscriptionId });
  if (result.state !== "ALLOCATED") throw new HttpError(400, "This payment cannot be allocated to the chosen subscription");
  return result;
}
