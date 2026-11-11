import { apiFetch, apiFetchBlob } from "@/lib/api";
import type { AccountingOptions, AccountingReport, JournalDetail, AccountingAccount, AccountingPage, AccountingFiscalYear, AccountingApproval } from "../types";

export const getAccountingReport = (query: string, signal?: AbortSignal) => apiFetch<AccountingReport>(`/accounting/reports?${query}`, { signal });
export const getAccountingOptions = (search = "", signal?: AbortSignal) => apiFetch<AccountingOptions>(`/accounting/options?memberSearch=${encodeURIComponent(search)}`, { signal });
export const getAccountingJournal = (id: string, signal?: AbortSignal) => apiFetch<JournalDetail>(`/accounting/journals/${id}`, { signal });
export const exportAccounting = (query: string, format: "pdf" | "xlsx") => apiFetchBlob(`/accounting/export?${query}&format=${format}`);

export const getAccountingAccounts = (query: { page: number; pageSize: number; search?: string; active?: "true" | "false" }, signal?: AbortSignal) =>
  apiFetch<AccountingPage<AccountingAccount>>(`/accounting/coa?${new URLSearchParams({ ...query, page: String(query.page), pageSize: String(query.pageSize) })}`, { signal });
export const getAccountingAccountSummary = (signal: AbortSignal) => getAccountingAccounts({ page: 1, pageSize: 1 }, signal);
// Fiscal-year endpoint returns an array, not a paginated envelope (backend cap: 100 years/53 periods per year).
export const getAccountingFiscalYears = (signal: AbortSignal) => apiFetch<AccountingFiscalYear[]>("/accounting/periods/fiscal-years", { signal });
// Backend total is actor-scoped (requester or assigned approver), not the global approval queue.
export const getAccountingPendingApprovals = (signal: AbortSignal) => apiFetch<AccountingPage<AccountingApproval>>("/accounting/approvals?status=PENDING&page=1&pageSize=1", { signal });
// Compatibility with accounting.schema.ts: the existing donation report accepts only these codes.
// Labels/existence come from COA; other accounts belong to the later full-ledger workspace.
export async function getAccountingReportAccounts(signal: AbortSignal) {
  const codes = ["1110", "4110"];
  const pages = await Promise.all(codes.map(search => getAccountingAccounts({ page: 1, pageSize: 100, search }, signal)));
  return pages.flatMap((page, i) => page.rows.filter(account => account.code === codes[i]));
}
