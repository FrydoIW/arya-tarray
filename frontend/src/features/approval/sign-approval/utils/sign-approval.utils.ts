import { BUSINESS_TIME_ZONE, businessMonthValue } from "@/lib/business-time";
import type {
  SignApprovalQueueItem,
  SignApprovalStatus,
  SignApprovalStatusFilter
} from "../types";

export function formatStatementPeriod(periodFrom: string | null, periodTo: string | null) {
  if (!periodFrom && !periodTo) return "—";

  const from = periodFrom ? new Date(periodFrom) : null;
  const to = periodTo ? new Date(periodTo) : null;
  const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: BUSINESS_TIME_ZONE });
  const dateFormatter = new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short", year: "numeric", timeZone: BUSINESS_TIME_ZONE });

  if (from && to && businessMonthValue(from) === businessMonthValue(to)) {
    return monthFormatter.format(from);
  }
  if (from && to) return `${dateFormatter.format(from)} – ${dateFormatter.format(to)}`;
  return dateFormatter.format((from ?? to)!);
}

export function approvalStatusLabel(status: SignApprovalStatus) {
  if (status === "PENDING") return "Pending";
  if (status === "APPROVED") return "Approved";
  if (status === "REJECTED") return "Rejected";
  return status.replaceAll("_", " ");
}

export function approvalStatusTone(status: SignApprovalStatus) {
  if (status === "APPROVED") return "approved";
  if (status === "REJECTED") return "rejected";
  return "pending";
}

export function filterApprovalQueue(
  items: SignApprovalQueueItem[],
  search: string,
  statusFilter: SignApprovalStatusFilter
) {
  const query = search.trim().toLowerCase();

  return items.filter((item) => {
    if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
    if (!query) return true;

    const account = item.statement.bankAccount;
    return [
      item.statement.id,
      account.bankCode,
      account.bankName,
      account.accountNo,
      account.accountName,
      item.statement.uploadedBy.fullName
    ].some((value) => value.toLowerCase().includes(query));
  });
}
