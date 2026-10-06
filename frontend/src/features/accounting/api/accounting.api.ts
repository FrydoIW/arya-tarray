import { apiFetch, apiFetchBlob } from "@/lib/api";
import type { AccountingOptions, AccountingReport, JournalDetail } from "../types";

export const getAccountingReport = (query: string, signal?: AbortSignal) => apiFetch<AccountingReport>(`/accounting/reports?${query}`, { signal });
export const getAccountingOptions = (search = "", signal?: AbortSignal) => apiFetch<AccountingOptions>(`/accounting/options?memberSearch=${encodeURIComponent(search)}`, { signal });
export const getAccountingJournal = (id: string) => apiFetch<JournalDetail>(`/accounting/journals/${id}`);
export const exportAccounting = (query: string, format: "pdf" | "xlsx") => apiFetchBlob(`/accounting/export?${query}&format=${format}`);
