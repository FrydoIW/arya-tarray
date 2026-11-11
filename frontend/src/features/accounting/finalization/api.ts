import { apiFetch } from '@/lib/api';
import type { BankMatch, BankReconciliationDetail, BankReconciliationPage, ClosingPreview, ClosingRequestResult, FinancialIntegrity, SubledgerBundle } from './types';

const read = <T>(path: string, signal: AbortSignal) => apiFetch<T>(`/accounting/${path}`, { signal });
const write = <T>(path: string, body: unknown) => apiFetch<T>(`/accounting/${path}`, { method: 'POST', body: JSON.stringify(body) });

export const readSubledgerReconciliation = (fiscalYearId: string, asOf: string, signal: AbortSignal) =>
  read<SubledgerBundle>(`subledger-reconciliation?${new URLSearchParams({ fiscalYearId, asOf })}`, signal);
export const readBankReconciliations = (page: number, signal: AbortSignal) => read<BankReconciliationPage>(`bank-reconciliations?page=${page}&pageSize=25`, signal);
export const readBankReconciliation = (id: string, signal: AbortSignal) => read<BankReconciliationDetail>(`bank-reconciliations/${id}`, signal);
export const createBankReconciliation = (body: { bankAccountId: string; bankGlAccountId: string; accountingPeriodId: string; statementUploadId: string | null; reconciliationReference: string; statementOpeningBalance: string; statementClosingBalance: string; openingEvidence: string; statementEvidence: string; timingItems: Array<{ kind: 'OUTSTANDING_PAYMENT' | 'DEPOSIT_IN_TRANSIT'; journalLineId: string; amount: string; evidence: string }> }) => write<unknown>('bank-reconciliations', body);
export const matchBankMovement = (id: string, body: { bankTransactionId: string; journalLineId: string; amount: string; evidence: string }) => write<BankMatch>(`bank-reconciliations/${id}/matches`, body);
export const voidBankMatch = (id: string, matchId: string, reason: string) => write<{ matchId: string; status: string }>(`bank-reconciliations/${id}/void-match`, { matchId, reason });
export const submitBankReconciliation = (id: string, expectedRevision: number) => write<{ id: string }>(`bank-reconciliations/${id}/submit`, { expectedRevision });
export const requestBankReopen = (id: string, expectedRevision: number, reason: string, evidenceReference: string) => write<{ id: string }>(`bank-reconciliations/${id}/reopen-request`, { expectedRevision, reason, evidenceReference });
export const createBankAdjustment = (id: string, body: { bankTransactionId: string; kind: 'CHARGE' | 'INTEREST'; offsetAccountId: string; evidence: string }) => write<{ id: string }>(`bank-reconciliations/${id}/adjustment-drafts`, body);

export const readClosingPreview = (type: 'PERIOD' | 'YEAR', id: string, signal: AbortSignal) => read<ClosingPreview>(`${type === 'PERIOD' ? 'periods' : 'fiscal-years'}/${id}/closing-preview`, signal);
export const requestClosing = (type: 'PERIOD' | 'YEAR', id: string, reopen: boolean, reason: string, evidenceReference: string) =>
  write<ClosingRequestResult>(`${type === 'PERIOD' ? 'periods' : 'fiscal-years'}/${id}/${reopen ? 'reopen-request' : 'close-request'}`, { reason, evidenceReference });
export const readFinancialIntegrity = (query: { fiscalYearId: string; from: string; to: string }, signal: AbortSignal) =>
  read<FinancialIntegrity>(`financial-integrity?${new URLSearchParams(query)}`, signal);
