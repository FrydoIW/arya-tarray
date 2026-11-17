import { BUSINESS_TIME_ZONE, businessMonthValue } from "../../../../lib/business-time";
import { paymentOnlyTimePreview } from "../../../../lib/time-based-preview";
import type {
  DraftRowStatus,
  DraftTransaction,
  EventCodeChildOption,
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

export type ChildResolutionState = "NO_CHILDREN" | "AUTO_SELECT" | "MANUAL_REQUIRED" | "ALL_INACTIVE" | "RESOLVED" | "STALE";

export function childrenOfParent(children: EventCodeChildOption[], eventCodeId?: string | null) {
  if (!eventCodeId) return [];
  return children.filter((child) => child.eventCodeId === eventCodeId);
}

export function getChildResolutionState(transaction: DraftTransaction, children: EventCodeChildOption[]): ChildResolutionState {
  if (!transaction.eventCodeId) return "NO_CHILDREN";
  const parentChildren = childrenOfParent(children, transaction.eventCodeId);
  if (parentChildren.length === 0) return "NO_CHILDREN";
  if (transaction.eventCodeChildId) {
    const child = parentChildren.find((item) => item.id === transaction.eventCodeChildId);
    if (!child) return "STALE";
    if (!child.activeFlag) return "STALE";
    return "RESOLVED";
  }
  const active = parentChildren.filter((child) => child.activeFlag);
  if (active.length === 0) return "ALL_INACTIVE";
  if (active.length === 1) return "AUTO_SELECT";
  return "MANUAL_REQUIRED";
}

export function autoSelectChildId(transaction: DraftTransaction, children: EventCodeChildOption[]) {
  if (getChildResolutionState(transaction, children) !== "AUTO_SELECT") return null;
  const active = childrenOfParent(children, transaction.eventCodeId).filter((child) => child.activeFlag);
  return active.length === 1 ? active[0].id : null;
}

export function childNeedsReview(transaction: DraftTransaction, children: EventCodeChildOption[]) {
  const state = getChildResolutionState(transaction, children);
  return state === "MANUAL_REQUIRED" || state === "ALL_INACTIVE" || state === "STALE"
    || (state === "AUTO_SELECT" && !transaction.eventCodeChildId);
}

export function getDraftRowStatus(transaction: DraftTransaction, eventCodes: EventCodeOption[] = [], children: EventCodeChildOption[] = []): DraftRowStatus {
  if (!requiresEventClassification(transaction)) return "NOT_APPLICABLE";
  if (!transaction.eventCodeId) return "NEEDS_REVIEW";
  const event = getEventCode(eventCodes, transaction.eventCodeId);
  if (event?.eventType === "CAMPAIGN" && !transaction.eventCampaignId) return "NEEDS_REVIEW";
  if (event?.eventType === "TIME_BASED" && (!event.timeRule?.activeFlag
    || !paymentOnlyTimePreview(transaction.baseAmount ?? "", event.timeRule.unitAmount, event.timeRule.durationMonths))) return "NEEDS_REVIEW";
  if (childNeedsReview(transaction, children)) return "NEEDS_REVIEW";
  if (event?.eventType === "ITEM_SALE") {
    const child = children.find(item => item.id === transaction.eventCodeChildId);
    const quantity = transaction.itemSaleQuantity ?? transaction.itemSale?.quantity ?? null;
    if (!child?.itemSaleUnitPrice || !quantity || quantity <= 0) return "NEEDS_REVIEW";
  }
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

export function countNeedsReview(transactions: DraftTransaction[], children: EventCodeChildOption[] = []) {
  return transactions.filter((item) => getDraftRowStatus(item, [], children) === "NEEDS_REVIEW").length;
}

export function countResolvedTransactions(transactions: DraftTransaction[], children: EventCodeChildOption[] = []) {
  return transactions.filter((item) => getDraftRowStatus(item, [], children) !== "NEEDS_REVIEW").length;
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
