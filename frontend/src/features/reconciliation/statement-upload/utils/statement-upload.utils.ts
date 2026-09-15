import { BUSINESS_TIME_ZONE, businessMonthValue } from "../../../../lib/business-time";
import { paymentOnlyTimePreview } from "../../../../lib/time-based-preview";
import type {
  DraftRowStatus,
  DraftTransaction,
  EventCodeOption,
  StatementLifecycleStatus
} from "../types";

export function getStatementStatusLabel(status: StatementLifecycleStatus) {
  switch (status) {
    case "RAW":
      return "Draft";
    case "CHECK":
      return "Pending Approval";
    case "FINALIZED":
      return "Complete";
  }
}

export function getStatementStatusTone(status: StatementLifecycleStatus) {
  switch (status) {
    case "RAW":
      return "draft";
    case "CHECK":
      return "pending";
    case "FINALIZED":
      return "complete";
  }
}

export function requiresEventClassification(transaction: DraftTransaction) {
  return transaction.requiresClassification;
}

export function getDraftRowStatus(transaction: DraftTransaction, eventCodes: EventCodeOption[] = []): DraftRowStatus {
  if (!requiresEventClassification(transaction)) return "NOT_APPLICABLE";
  if (!transaction.eventCodeId) return "NEEDS_REVIEW";
  const event = getEventCode(eventCodes, transaction.eventCodeId);
  if (event?.eventType === "CAMPAIGN" && !transaction.eventCampaignId) return "NEEDS_REVIEW";
  if (event?.eventType === "TIME_BASED" && (!event.timeRule?.activeFlag
    || !paymentOnlyTimePreview(transaction.baseAmount ?? "", event.timeRule.unitAmount, event.timeRule.durationMonths))) return "NEEDS_REVIEW";
  if (transaction.suggestedEventCodeId && transaction.eventCodeId === transaction.suggestedEventCodeId) {
    return "MATCHED";
  }
  return "READY";
}

export function getDraftRowStatusLabel(status: DraftRowStatus) {
  switch (status) {
    case "MATCHED":
      return "Matched";
    case "READY":
      return "Ready";
    case "NEEDS_REVIEW":
      return "Needs Review";
    case "NOT_APPLICABLE":
      return "Not Applicable";
  }
}

export function getEventCode(eventCodes: EventCodeOption[], eventCodeId?: string | null) {
  if (!eventCodeId) return null;
  return eventCodes.find((item) => item.id === eventCodeId) ?? null;
}

export function getEventCodeLabel(eventCode: EventCodeOption | null) {
  if (!eventCode) return "No Match";
  return `${eventCode.code} - ${eventCode.eventName}`;
}

export function countNeedsReview(transactions: DraftTransaction[]) {
  return transactions.filter((item) => getDraftRowStatus(item) === "NEEDS_REVIEW").length;
}

export function countResolvedTransactions(transactions: DraftTransaction[]) {
  return transactions.filter((item) => getDraftRowStatus(item) !== "NEEDS_REVIEW").length;
}

export function formatStatementPeriod(periodFrom: string | null, periodTo: string | null) {
  if (!periodFrom || !periodTo) return "-";
  const from = new Date(periodFrom);
  const to = new Date(periodTo);
  const sameMonth = businessMonthValue(from) === businessMonthValue(to);

  if (sameMonth) {
    return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: BUSINESS_TIME_ZONE }).format(from);
  }

  const formatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: BUSINESS_TIME_ZONE });
  return `${formatter.format(from)} - ${formatter.format(to)}`;
}
