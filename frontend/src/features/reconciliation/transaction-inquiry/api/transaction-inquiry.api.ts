import { apiFetch, apiFetchBlob } from "@/lib/api";
import type {
  TransactionInquiryDetail,
  TransactionInquiryMemberOptions,
  TransactionInquiryQuery,
  TransactionInquiryWorkspace,
  TransactionReportOptions
} from "../types";

function queryParams(query: Omit<TransactionInquiryQuery, "page" | "pageSize">) {
  const params = new URLSearchParams({ periodMode: query.periodMode });
  if (query.periodMode === "MONTH") params.set("month", query.month);
  else params.set("date", query.date);
  if (query.search.trim()) params.set("search", query.search.trim());
  if (query.status !== "ALL") params.set("status", query.status);
  if (query.bankAccountId !== "ALL") params.set("bankAccountId", query.bankAccountId);
  if (query.finalEventId !== "ALL") params.set("finalEventId", query.finalEventId);
  if (query.memberId !== "ALL") params.set("memberId", query.memberId);
  if (query.memberLinkStatus !== "ALL") params.set("memberLinkStatus", query.memberLinkStatus);
  return params;
}

export function getTransactionInquiryMemberOptions(search: string) {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  return apiFetch<TransactionInquiryMemberOptions>(`/reconciliation/transaction-inquiry/member-options?${params.toString()}`);
}

export function getTransactionInquiryWorkspace(query: TransactionInquiryQuery) {
  const params = queryParams(query);
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  return apiFetch<TransactionInquiryWorkspace>(`/reconciliation/transaction-inquiry/workspace?${params.toString()}`);
}

export function getTransactionInquiryDetail(transactionId: string) {
  return apiFetch<TransactionInquiryDetail>(`/reconciliation/transaction-inquiry/${encodeURIComponent(transactionId)}`);
}

export function generateTransactionInquiryReport(
  query: Omit<TransactionInquiryQuery, "page" | "pageSize">,
  options: TransactionReportOptions
) {
  const params = queryParams(query);
  params.set("includeFinancialSummary", String(options.includeFinancialSummary));
  params.set("includeClassificationSummary", String(options.includeClassificationSummary));
  params.set("includeTransactionDetail", String(options.includeTransactionDetail));
  return apiFetchBlob(`/reconciliation/transaction-inquiry/report?${params.toString()}`);
}
