import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { decimalStringToCents } from "../../reconciliation/reconciliation-classification.js";
import { resolveTimeBasedUnits } from "../../reconciliation/time-based-classification.js";
import { allocatePostingSequences, assertRebuildHasNoActiveTransferRelation, lockSubscriptionsForPosting } from "./member-carry-transfer.foundation.js";

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
  eventCodeId: string | null; principalAmount: { toString(): string }; alternativePrincipalAmount?: { toString(): string } | null; recalculate: boolean;
  coverages: Array<{ coverageStatus: string; subscriptionEventCodeId: string; unitAmount: { toString(): string } | null;
    durationMonths: number | null; grantedUnits: number | null; amountApplied: { toString(): string } | null }>;
}) {
  if (!input.eventCodeId || input.recalculate) return null;
  const matches = (amount: { toString(): string } | null) => amount
    ? input.coverages.find(row => row.subscriptionEventCodeId === input.eventCodeId
      && row.amountApplied && cents(row.amountApplied) === cents(amount)) : undefined;
  // Prefer the full PAYMENT amount. The alternative is only a legacy snapshot
  // fallback, and remains constrained to this Event Code and transaction.
  const historical = matches(input.principalAmount)
    ?? (input.alternativePrincipalAmount && cents(input.alternativePrincipalAmount) !== cents(input.principalAmount)
      ? matches(input.alternativePrincipalAmount) : undefined);
  return historical ? historicalCoverageEntitlement({ eventCodeId: input.eventCodeId,
    subscriptionEventCodeId: historical.subscriptionEventCodeId, unitAmount: historical.unitAmount,
    durationMonths: historical.durationMonths, grantedUnits: historical.grantedUnits,
    amountApplied: historical.amountApplied }) : null;
}
export function selectHistoricalPaymentSnapshot(input: {
  eventCodeId: string | null; principalAmount: { toString(): string }; alternativePrincipalAmount?: { toString(): string } | null; recalculate: boolean;
  entries: Array<{ entryType: string; amountDelta: { toString(): string }; unitAmountSnapshot: { toString(): string } | null;
    durationMonthsSnapshot: number | null; subscription: { eventCodeId: string } }>;
}) {
  if (!input.eventCodeId || input.recalculate) return null;
  const matches = (amount: { toString(): string }) => input.entries.find(item => item.entryType === "PAYMENT"
    && item.subscription.eventCodeId === input.eventCodeId && cents(item.amountDelta) === cents(amount)
    && item.unitAmountSnapshot && item.durationMonthsSnapshot);
  const row = matches(input.principalAmount)
    ?? (input.alternativePrincipalAmount && cents(input.alternativePrincipalAmount) !== cents(input.principalAmount)
      ? matches(input.alternativePrincipalAmount) : undefined);
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

/**
 * The schema intentionally has no unsafe "one inactive record" constraint. This range lock
 * serializes the only lifecycle transition that may introduce an ACTIVE logical program.
 * It relies on idx_member_event_sub_member_event and is held by the caller's transaction.
 */
export async function lockActiveTimeBasedProgram(tx: Tx, memberId: string, eventCodeId: string) {
  const raw = tx as Tx & { $queryRaw?: <T = unknown>(query: Prisma.Sql) => Promise<T> };
  if (typeof raw.$queryRaw !== "function") return;
  await raw.$queryRaw(Prisma.sql`SELECT member_event_subscription_id FROM arya_member_event_subscription
    WHERE member_id = ${memberId} AND event_code_id = ${eventCodeId} AND active_flag = 1
    ORDER BY member_event_subscription_id FOR UPDATE`);
}

/** Returns the single current program, creates it under the range lock, or reports a legacy ambiguity. */
export async function ensureActiveTimeBasedProgram(tx: Tx, input: { memberId: string; eventCodeId: string; userId: string }) {
  await lockActiveTimeBasedProgram(tx, input.memberId, input.eventCodeId);
  const matches = await tx.memberEventSubscription.findMany({ where: { memberId: input.memberId,
    eventCodeId: input.eventCodeId, activeFlag: true }, select: { id: true } });
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) return null;
  const created = await tx.memberEventSubscription.create({ data: {
    memberId: input.memberId, eventCodeId: input.eventCodeId, activeFlag: true,
    createdById: input.userId, updatedById: input.userId
  }, select: { id: true } });
  return created.id;
}

function hasResolvableCurrentTimeRule(payment: Payment) {
  try {
    return Boolean(resolveTimeBasedUnits({ eventCode: payment.eventCode, rule: payment.eventCode?.timeRule ?? null,
      transaction: payment, requiresClassification: true }));
  } catch { return false; }
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
      principalAmount: payment.originalAmount, alternativePrincipalAmount: payment.baseAmount, recalculate: false, entries })
      ?? selectHistoricalCoverageEntitlement({ eventCodeId: payment.eventCodeId,
        principalAmount: payment.originalAmount, alternativePrincipalAmount: payment.baseAmount, recalculate: false,
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
export async function refreshSubscriptionValidity(tx: Tx, subscriptionId: string) {
  const latest = await tx.memberEventCoverage.findFirst({ where: { subscriptionId, ...activeCoverage },
    orderBy: [{ coverageTo: "desc" }, { id: "desc" }], select: { coverageTo: true } });
  await tx.memberEventSubscription.update({ where: { id: subscriptionId }, data: { validUntil: latest?.coverageTo ?? null } });
}
function earliestDate(values: Array<Date | null | undefined>) {
  return values.filter((value): value is Date => Boolean(value)).reduce<Date | null>((earliest, value) =>
    !earliest || value.getTime() < earliest.getTime() ? utcDay(value) : earliest, null);
}
export function resolveEffectiveStartDate(input: { coverageFrom: Date[]; paymentDates: Date[]; transferInDates?: Date[] }) {
  return earliestDate([...input.coverageFrom, ...input.paymentDates, ...(input.transferInDates ?? [])]);
}
/** Re-resolves the system-managed participation start from surviving financial evidence. */
export async function refreshSubscriptionStartDate(tx: Tx, subscriptionId: string) {
  const [payments, coverages] = await Promise.all([
    tx.memberEventBalanceLedger.findMany({ where: { subscriptionId, entryStatus: "ACTIVE", OR: [
      { entryType: "PAYMENT" },
      { entryType: "TRANSFER_IN", carryTransfer: { is: { status: "ACTIVE" } } }
    ] },
      select: { effectiveDate: true } }),
    tx.memberEventCoverage.findMany({ where: { subscriptionId, ...activeCoverage }, select: { coverageFrom: true } })
  ]);
  const startDate = earliestDate([...payments.map(row => row.effectiveDate), ...coverages.map(row => row.coverageFrom)]);
  await tx.memberEventSubscription.update({ where: { id: subscriptionId }, data: { startDate } });
  return startDate;
}

/**
 * Appends a genuinely later finalized bank payment without replaying pre-existing
 * Carry Transfer economics. Historical corrections still fall back to the guarded
 * rebuild path below.
 */
async function appendForwardTimeBasedPayment(tx: Tx, subscriptionId: string, payment: Payment, userId: string, recalculate: boolean) {
  if (recalculate || !payment.transactionDate) return false;
  await lockSubscriptionsForPosting(tx, [subscriptionId]);
  const sub = await tx.memberEventSubscription.findUnique({ where: { id: subscriptionId },
    select: { id: true, memberId: true, eventCodeId: true } });
  if (!sub || !eligible(payment, sub)) return false;
  const existing = await tx.memberEventBalanceLedger.findFirst({ where: { subscriptionId, bankTransactionId: payment.id,
    entryType: "PAYMENT", ...activeEntry }, select: { id: true } });
  if (existing) return true;
  const latestEconomic = await tx.memberEventBalanceLedger.findFirst({ where: { subscriptionId, ...activeEntry },
    orderBy: [{ effectiveDate: "desc" }, { postingSequence: "desc" }], select: { effectiveDate: true } });
  if (latestEconomic && latestEconomic.effectiveDate.getTime() > payment.transactionDate.getTime()) return false;
  const rate = await snapshot(tx, payment, false);
  const unitAmount = decimalStringToCents(rate.unitAmount);
  const balance = await tx.memberEventBalanceLedger.aggregate({ where: { subscriptionId, ...activeEntry }, _sum: { amountDelta: true } });
  const grant = calculateCarryGrant(decimalStringToCents(balance._sum.amountDelta?.toString() ?? "0"), cents(payment.originalAmount), unitAmount);
  const months = grant.grantedUnits * rate.durationMonths;
  if (!Number.isSafeInteger(months)) throw new HttpError(400, "TIME_BASED coverage duration is too large");
  const sequences = await allocatePostingSequences(tx, subscriptionId, months ? 2 : 1);
  await tx.memberEventBalanceLedger.create({ data: {
    subscriptionId, bankTransactionId: payment.id, entryType: "PAYMENT", entryStatus: "ACTIVE",
    amountDelta: money(cents(payment.originalAmount)), effectiveDate: payment.transactionDate,
    unitAmountSnapshot: rate.unitAmount, durationMonthsSnapshot: rate.durationMonths,
    postingSequence: sequences[0], createdById: userId
  } });
  if (months) {
    const latestCoverage = await tx.memberEventCoverage.findFirst({ where: { subscriptionId, ...activeCoverage },
      orderBy: [{ coverageTo: "desc" }, { id: "desc" }], select: { coverageTo: true } });
    const coverageFrom = resolveCoverageStart({ latestCoverageTo: latestCoverage?.coverageTo ?? null,
      startDate: payment.transactionDate, transactionDate: payment.transactionDate });
    const coverage = await tx.memberEventCoverage.create({ data: {
      subscriptionId, bankTransactionId: payment.id, coverageSource: "TRANSACTION", coverageStatus: "ACTIVE",
      unitAmountSnapshot: rate.unitAmount, durationMonthsSnapshot: rate.durationMonths, grantedUnits: grant.grantedUnits,
      amountApplied: money(grant.amountConsumed), coverageFrom, coverageTo: addCalendarMonthsInclusive(coverageFrom, months), createdById: userId
    } });
    await tx.memberEventBalanceLedger.create({ data: {
      subscriptionId, bankTransactionId: payment.id, coverageId: coverage.id, entryType: "COVERAGE_USE", entryStatus: "ACTIVE",
      amountDelta: money(-grant.amountConsumed), effectiveDate: payment.transactionDate,
      unitAmountSnapshot: rate.unitAmount, durationMonthsSnapshot: rate.durationMonths, postingSequence: sequences[1], createdById: userId
    } });
  }
  await Promise.all([refreshSubscriptionValidity(tx, subscriptionId), refreshSubscriptionStartDate(tx, subscriptionId)]);
  return true;
}
async function rebuildSubscription(tx: Tx, subscriptionId: string, userId: string, reason: string,
  addition?: { payment: Payment; recalculate: boolean }) {
  await lockSubscriptionsForPosting(tx, [subscriptionId]);
  await assertRebuildHasNoActiveTransferRelation(tx, subscriptionId);
  const sub = await tx.memberEventSubscription.findUnique({ where: { id: subscriptionId },
    select: { id: true, memberId: true, eventCodeId: true, startDate: true, validUntil: true } });
  if (!sub) return;
  const [ledger, coverage, openings, activeLedger, transferIns] = await Promise.all([
    tx.memberEventBalanceLedger.findMany({ where: { subscriptionId, entryType: "PAYMENT", ...activeEntry },
      select: { bankTransactionId: true, amountDelta: true, unitAmountSnapshot: true, durationMonthsSnapshot: true, effectiveDate: true } }),
    tx.memberEventCoverage.findMany({ where: { subscriptionId, coverageSource: "TRANSACTION", ...activeCoverage },
      select: { bankTransactionId: true, coverageFrom: true, coverageTo: true, unitAmountSnapshot: true,
        durationMonthsSnapshot: true, grantedUnits: true, amountApplied: true } }),
    tx.memberEventCoverage.findMany({ where: { subscriptionId, coverageSource: "OPENING", ...activeCoverage },
      select: { coverageFrom: true, coverageTo: true }, orderBy: [{ coverageTo: "desc" }, { id: "desc" }] }),
    tx.memberEventBalanceLedger.findMany({ where: { subscriptionId, entryType: "COVERAGE_USE", ...activeEntry },
      select: { bankTransactionId: true, amountDelta: true, coverage: { select: { coverageSource: true } } } }),
    tx.memberEventBalanceLedger.findMany({ where: { subscriptionId, entryType: "TRANSFER_IN", ...activeEntry,
      carryTransfer: { is: { status: "ACTIVE" } } }, select: { effectiveDate: true } })
  ]);
  // Transfer-generated allocation always owns a TRANSFER-source coverage. Transfer commands
  // never allow that state to survive without an ACTIVE transfer, so this is a defensive
  // integrity conflict: broad rebuild must not silently replay pooled transfer economics.
  if (activeLedger.some(row => row.coverage?.coverageSource === "TRANSFER"))
    throw new HttpError(409, "This subscription has Carry Transfer-generated coverage. Broad TIME_BASED rebuild cannot safely replay transfer allocation; unwind the related transfer or use a dedicated correction path.");
  const ids = [...new Set([...ledger, ...coverage].flatMap(row => row.bankTransactionId ? [row.bankTransactionId] : []))];
  if (addition && !ids.includes(addition.payment.id)) ids.push(addition.payment.id);
  const payments = ids.length ? await tx.bankTransaction.findMany({ where: { id: { in: ids } }, select: paymentSelect }) : [];
  if (addition && !payments.some(row => row.id === addition.payment.id)) payments.push(addition.payment);
  const surviving = payments.filter(row => eligible(row, sub)).sort((a, b) =>
    a.transactionDate!.getTime() - b.transactionDate!.getTime() || a.id.localeCompare(b.id));
  const snapshots = await Promise.all(surviving.map(row => snapshot(tx, row, addition?.payment.id === row.id && addition.recalculate)));
  const effectiveStartDate = resolveEffectiveStartDate({ coverageFrom: openings.map(row => row.coverageFrom),
    paymentDates: surviving.map(row => row.transactionDate!), transferInDates: transferIns.map(row => row.effectiveDate) });
  let balance = 0n;
  let lastCoverageTo = openings[0]?.coverageTo ?? null;
  const plan = surviving.map((payment, index) => {
    const rate = snapshots[index];
    // The derived base amount is a classification aid only. The complete
    // finalized bank amount (including the three-digit suffix) remains donor
    // money in the wallet and therefore drives PAYMENT/carry arithmetic.
    const amount = cents(payment.originalAmount);
    const grant = calculateCarryGrant(balance, amount, decimalStringToCents(rate.unitAmount));
    const months = grant.grantedUnits * rate.durationMonths;
    if (!Number.isSafeInteger(months)) throw new HttpError(400, "TIME_BASED coverage duration is too large");
    const from = months ? resolveCoverageStart({ latestCoverageTo: lastCoverageTo,
      startDate: effectiveStartDate, transactionDate: payment.transactionDate! }) : null;
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
  if (unchanged) {
    if (sub.startDate?.getTime() !== effectiveStartDate?.getTime())
      await tx.memberEventSubscription.update({ where: { id: subscriptionId }, data: { startDate: effectiveStartDate } });
    return;
  }
  const postingCount = plan.length + plan.filter(row => row.from).length;
  const postingSequences = postingCount ? await allocatePostingSequences(tx, subscriptionId, postingCount) : [];
  let postingSequenceIndex = 0;
  const now = new Date();
  // Broad rebuild owns bank-payment economics only. TRANSFER_IN / TRANSFER_OUT are
  // append-only Carry Transfer audit owned by transfer and reversal commands, even
  // after a transfer is REVERSED, so they are never voided or regenerated here.
  await tx.memberEventBalanceLedger.updateMany({
    where: { subscriptionId, ...activeEntry, entryType: { in: ["PAYMENT", "COVERAGE_USE"] } },
    data: { entryStatus: "VOIDED", voidedAt: now, voidedById: userId, voidReason: reason } });
  await tx.memberEventCoverage.updateMany({ where: { subscriptionId, coverageSource: "TRANSACTION", ...activeCoverage },
    data: { coverageStatus: "VOIDED", voidedAt: now, voidedById: userId, voidReason: reason } });
  for (const { payment, rate, amount, grant, from, to } of plan) {
    const date = payment.transactionDate!;
    await tx.memberEventBalanceLedger.create({ data: {
      subscriptionId, bankTransactionId: payment.id, entryType: "PAYMENT", entryStatus: "ACTIVE",
      amountDelta: money(amount), effectiveDate: date, unitAmountSnapshot: rate.unitAmount,
      durationMonthsSnapshot: rate.durationMonths, postingSequence: postingSequences[postingSequenceIndex++], createdById: userId
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
        durationMonthsSnapshot: rate.durationMonths, postingSequence: postingSequences[postingSequenceIndex++], createdById: userId
      } });
    }
  }
  await tx.memberEventSubscription.update({ where: { id: subscriptionId }, data: { startDate: effectiveStartDate, validUntil: lastCoverageTo } });
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
      // Invalid or missing rules remain visible as an exception; do not fabricate a program.
      // A valid first finalized payment establishes the normal Member + Event logical program.
      if (!hasResolvableCurrentTimeRule(payment)) pending = "PENDING_SUBSCRIPTION";
      else {
        const ensured = await ensureActiveTimeBasedProgram(tx, { memberId, eventCodeId: payment.eventCodeId!, userId });
        if (ensured) destination = ensured;
        else pending = "AMBIGUOUS";
      }
    }
  }
  const active = activePayments.length === 1 ? activePayments[0] : null;
  if (destination && active && active.subscriptionId === destination && oldIds.length === 1
    && !options?.recalculate && active.unitAmountSnapshot && active.durationMonthsSnapshot
    && cents(active.amountDelta) === cents(payment.originalAmount)
    && isCurrentTimeBasedAllocation({ subscriptionMemberId: active.subscription.memberId,
      subscriptionEventCodeId: active.subscription.eventCodeId, paymentMemberId: memberId,
      paymentEventCodeId: payment.eventCodeId, verificationStatus: payment.memberIdentity?.verificationStatus }))
    return { state: "ALLOCATED" as const, subscriptionId: destination };
  for (const oldId of oldIds.filter(id => id !== destination))
    await rebuildSubscription(tx, oldId, userId, "Official allocation or Member ownership changed");
  if (destination) {
    // A new later finalized payment is normal forward activity. It must be
    // appended against the live wallet rather than attempting an unsafe replay
    // through already-posted Carry Transfer relationships.
    if (!active && !options?.recalculate
      && await appendForwardTimeBasedPayment(tx, destination, payment, userId, false))
      return { state: "ALLOCATED" as const, subscriptionId: destination };
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
