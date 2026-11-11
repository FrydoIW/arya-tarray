import { apiFetch } from '@/lib/api';
import type { AccountingAccount, AccountingPage } from '../types';
import type { AccountInput, Approval, ApprovalDetail, CoreJournal, Draft, DraftHeader, DraftInput, Ledger, Trial } from './types';

export function coreQuery(values: Record<string, string | number | undefined>) {
  return new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])).toString();
}
export const coreRead = <T>(path: string, signal: AbortSignal) => apiFetch<T>(`/accounting/${path}`, { signal });
const write = <T>(path: string, method: string, body?: unknown) => apiFetch<T>(`/accounting/${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const saveAccount = (id: string | null, input: AccountInput | Partial<AccountInput>) => write<AccountingAccount>(`coa${id ? `/${id}` : ''}`, id ? 'PATCH' : 'POST', input);
export const listDrafts = (query: string, signal: AbortSignal) => coreRead<AccountingPage<DraftHeader>>(`journal-drafts?${query}`, signal);
export const readDraft = (id: string, signal: AbortSignal) => coreRead<Draft>(`journal-drafts/${id}`, signal);
export const saveDraft = (id: string | null, input: DraftInput, revision?: number) => write<Draft>(`journal-drafts${id ? `/${id}` : ''}`, id ? 'PATCH' : 'POST', { ...input, ...(id ? { expectedRevision: revision } : {}) });
export const requestApproval = (input: { kind: 'MANUAL_JOURNAL' | 'ADJUSTING_JOURNAL'; sourceDocumentId: string; expectedRevision: number } | { kind: 'JOURNAL_REVERSAL'; sourceDocumentId: string; accountingDate: string; remark: string }) => write<Approval>('approvals', 'POST', input);
export const readApproval = (id: string, signal: AbortSignal) => coreRead<ApprovalDetail>(`approvals/${id}`, signal);
export const decideApproval = (id: string, decision: 'APPROVED' | 'REJECTED', remark: string | null) => write<ApprovalDetail>(`approvals/${id}/decision`, 'POST', { decision, remark });
export const cancelApproval = (id: string, remark: string) => write<ApprovalDetail>(`approvals/${id}/cancel`, 'POST', { remark });
export const postApproval = (id: string) => write<unknown>(`approvals/${id}/post`, 'POST');
export const readJournal = (id: string, signal: AbortSignal) => coreRead<CoreJournal>(`journals/${id}`, signal);
export const readLedger = (query: string, signal: AbortSignal) => coreRead<Ledger>(`general-ledger?${query}`, signal);
export const readTrial = (query: string, signal: AbortSignal) => coreRead<Trial>(`trial-balance?${query}`, signal);
export const createFiscalYear = (input: { yearCode: string; startDate: string; endDate: string }) => write('periods/fiscal-years', 'POST', input);
export const createPeriod = (input: { fiscalYearId: string; periodNo: number; periodCode: string; startDate: string; endDate: string }) => write('periods', 'POST', input);
