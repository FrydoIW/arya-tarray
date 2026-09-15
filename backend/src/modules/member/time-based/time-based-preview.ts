import { resolveTimeBasedUnits } from "../../reconciliation/time-based-classification.js";
import { decimalStringToCents } from "../../reconciliation/reconciliation-classification.js";
import { centsToDecimal } from "../data/member-donation.domain.js";
import { selectHistoricalCoverageEntitlement, selectHistoricalPaymentSnapshot } from "./member-time-based.service.js";

export const timeBasedHistoryInclude = {
  memberEventBalanceLedger: {
    where: { entryType: "PAYMENT" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { entryType: true, entryStatus: true, subscriptionId: true, amountDelta: true,
      unitAmountSnapshot: true, durationMonthsSnapshot: true, subscription: { select: { eventCodeId: true } } }
  },
  memberEventCoverages: {
    where: { coverageSource: "TRANSACTION" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { coverageStatus: true, subscriptionId: true, unitAmountSnapshot: true,
      durationMonthsSnapshot: true, grantedUnits: true, amountApplied: true, subscription: { select: { eventCodeId: true } } }
  }
} satisfies Prisma.BankTransactionInclude;

type DecimalValue = { toString(): string };
type PreviewPayment = {
  eventCodeId: string | null; originalAmount: DecimalValue; baseAmount: DecimalValue | null;
  eventCode: { eventType: string; timeRule: { unitAmount: DecimalValue; durationMonths: number; activeFlag: boolean } | null } | null;
  memberEventBalanceLedger: Array<{ entryType: string; entryStatus: string; subscriptionId: string; amountDelta: DecimalValue;
    unitAmountSnapshot: DecimalValue | null; durationMonthsSnapshot: number | null; subscription: { eventCodeId: string } }>;
  memberEventCoverages: Array<{ coverageStatus: string; subscriptionId: string; unitAmountSnapshot: DecimalValue | null;
    durationMonthsSnapshot: number | null; grantedUnits: number | null; amountApplied: DecimalValue | null; subscription: { eventCodeId: string } }>;
};

/** Read-only display of the same historical rate selection used by allocation. */
export function timeBasedPaymentPreview(payment: PreviewPayment, recalculate = false) {
  if (payment.eventCode?.eventType !== "TIME_BASED" || !payment.baseAmount) return null;
  const principal = decimalStringToCents(payment.baseAmount.toString());
  if (principal <= 0n) return null;
  const entries = payment.memberEventBalanceLedger.slice().sort((a, b) => Number(b.entryStatus === "ACTIVE") - Number(a.entryStatus === "ACTIVE"));
  const historical = selectHistoricalPaymentSnapshot({ eventCodeId: payment.eventCodeId, principalAmount: payment.baseAmount, recalculate, entries });
  const legacy = historical ? null : selectHistoricalCoverageEntitlement({ eventCodeId: payment.eventCodeId,
    principalAmount: payment.baseAmount, recalculate, coverages: payment.memberEventCoverages.map(row => ({
      coverageStatus: row.coverageStatus, subscriptionEventCodeId: row.subscription.eventCodeId,
      unitAmount: row.unitAmountSnapshot, durationMonths: row.durationMonthsSnapshot,
      grantedUnits: row.grantedUnits, amountApplied: row.amountApplied
    })) });
  try {
    const rate = historical ?? legacy ?? resolveTimeBasedUnits({ eventCode: payment.eventCode,
      rule: payment.eventCode.timeRule, transaction: payment, requiresClassification: true });
    if (!rate) return null;
    const activePayment = !recalculate && entries.find(row => row.entryStatus === "ACTIVE"
      && row.subscription.eventCodeId === payment.eventCodeId && decimalStringToCents(row.amountDelta.toString()) === principal);
    const snapshotPayment = historical && entries.find(row => row.subscription.eventCodeId === payment.eventCodeId
      && decimalStringToCents(row.amountDelta.toString()) === principal
      && row.unitAmountSnapshot?.toString() === historical.unitAmount
      && row.durationMonthsSnapshot === historical.durationMonths);
    const actualCoverage = snapshotPayment && payment.memberEventCoverages.find(row =>
      row.coverageStatus === snapshotPayment.entryStatus && row.subscriptionId === snapshotPayment.subscriptionId
      && row.unitAmountSnapshot && decimalStringToCents(row.unitAmountSnapshot.toString()) === decimalStringToCents(rate.unitAmount)
      && row.durationMonthsSnapshot === rate.durationMonths);
    const unit = decimalStringToCents(rate.unitAmount);
    const grantedUnits = historical ? actualCoverage?.grantedUnits ?? 0 : legacy?.grantedUnits ?? Number(principal / unit);
    return { eventCodeId: payment.eventCodeId, historical: Boolean(historical || legacy), allocated: Boolean(historical || legacy),
      unitAmount: rate.unitAmount, durationMonths: rate.durationMonths, grantedUnits,
      grantedMonths: grantedUnits * rate.durationMonths, principalAmount: centsToDecimal(principal),
      paymentOnlyRemainder: centsToDecimal(principal % unit), paymentCredited: activePayment ? activePayment.amountDelta.toString() : null };
  } catch { return null; }
}
import type { Prisma } from "@prisma/client";
