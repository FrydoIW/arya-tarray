import { BUSINESS_TIME_ZONE, currentBusinessDayValue, currentBusinessMonthValue } from "@/lib/business-time";
import type { EditIncomePeriodMode } from "../types";
import type {
  CorrectionRowStatus,
  EditIncomeDetail,
  EditIncomeEventCode,
  EditIncomeTransaction,
  EditIncomeCorrectionRequest
} from "../types";

export function getEventCode(eventCodes: EditIncomeEventCode[], id: string | null) {
  return eventCodes.find((item) => item.id === id) ?? null;
}

export function getEventCodeLabel(eventCode: EditIncomeEventCode) {
  return `${eventCode.code} - ${eventCode.eventName}`;
}

export function getStatementStatusLabel(status: "COMPLETE" | "PENDING_REAPPROVAL") {
  return status === "PENDING_REAPPROVAL" ? "Pending Re-approval" : "Complete";
}

export function normalizeRemark(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

export function transactionChanged(
  current: EditIncomeTransaction,
  original: EditIncomeTransaction | undefined
) {
  if (!original) return current.correctionAction === "ADDED";
  return current.eventCodeId !== original.eventCodeId
    || current.eventCampaignId !== original.eventCampaignId
    || normalizeRemark(current.remark) !== normalizeRemark(original.remark);
}

export function getCorrectionRowStatus(
  current: EditIncomeTransaction,
  original: EditIncomeTransaction | undefined
): CorrectionRowStatus {
  if (current.correctionAction === "ADDED") return "ADDED";
  if (current.correctionAction === "EXCLUDED") return "EXCLUDED";
  if (current.reconciliationExcludedAt) return "EXCLUDED";
  if (transactionChanged(current, original)) return "MODIFIED";
  return "CURRENT";
}

export function buildCorrectionChanges(detail: EditIncomeDetail, draftTransactions: EditIncomeTransaction[]) {
  const originalById = new Map(detail.transactions.map((item) => [item.id, item]));
  const corrections: EditIncomeCorrectionRequest[] = [];
  for (const item of draftTransactions) {
    if (item.correctionAction === "ADDED") corrections.push({
      action: "ADDED" as const,
      clientId: item.id,
      direction: item.originalAmount.startsWith("-") ? "OUTGOING" as const : "INCOMING" as const,
      transactionDate: item.transactionDate!,
      description: item.description,
      amount: item.originalAmount.replace(/^-/, ""),
      eventCodeId: item.eventCodeId,
      eventCampaignId: item.eventCampaignId,
      remark: normalizeRemark(item.remark),
      reason: item.correctionReason!
    });
    else if (item.correctionAction === "EXCLUDED") corrections.push({
      action: "EXCLUDED" as const,
      transactionId: item.id,
      reason: item.correctionReason!
    });
    else if (transactionChanged(item, originalById.get(item.id))) corrections.push({
      action: "MODIFIED" as const,
      transactionId: item.id,
      eventCodeId: item.eventCodeId,
      eventCampaignId: item.eventCampaignId,
      remark: normalizeRemark(item.remark)
    });
  }
  return corrections;
}

export const getCurrentMonthValue = currentBusinessMonthValue;
export const getCurrentDayValue = currentBusinessDayValue;

export function formatMonthLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function formatDayLabel(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: BUSINESS_TIME_ZONE })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

export function formatPeriodLabel(mode: EditIncomePeriodMode, month: string, date: string) {
  return mode === "DAY" ? formatDayLabel(date) : formatMonthLabel(month);
}

export function periodContext(mode: EditIncomePeriodMode, month: string, date: string) {
  return `${mode === "DAY" ? "on" : "in"} ${formatPeriodLabel(mode, month, date)}`;
}
