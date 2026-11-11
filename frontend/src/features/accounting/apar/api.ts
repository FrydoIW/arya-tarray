import { apiFetch } from '@/lib/api';
import type { Approval, CoreJournal } from '../core/types';
import type { AdjustmentInput, Counterparty, CounterpartyInput, DocumentSource, DocumentInput, SettlementDetail, SettlementInput, Side, Source } from './types';

export const managementGrant = { ap: 'ACCOUNTING_AP_MANAGE', ar: 'ACCOUNTING_AR_MANAGE' } as const;
export const matchGrant = 'ACCOUNTING_SETTLEMENT_MATCH';
export const inquiryGrant = 'RECON_TRANSACTION_INQUIRY';

export function subledgerHref(side: Side) {
  return side === 'ap' ? '/accounting/payables' : '/accounting/receivables';
}

export function sourcePath(side: Side, source: Source, id?: string) {
  return [side, source, id].filter(Boolean).join('/');
}

function write<T>(path: string, method: 'POST' | 'PATCH', body: unknown) {
  return apiFetch<T>('/accounting/' + path, { method, body: JSON.stringify(body) });
}

export function saveCounterparty(input: CounterpartyInput) {
  return write<Counterparty>('counterparties', 'POST', input);
}

export function editCounterparty(id: string, input: Pick<CounterpartyInput, 'displayName' | 'activeFlag'>) {
  return write<Counterparty>('counterparties/' + id, 'PATCH', input);
}

export function saveDocument(side: Side, input: DocumentInput, existing?: Pick<DocumentSource, 'id' | 'revision'>) {
  return write<DocumentSource>(sourcePath(side, 'documents', existing?.id), existing ? 'PATCH' : 'POST',
    existing ? { ...input, expectedRevision: existing.revision } : input);
}

export function saveSettlement(side: Side, input: SettlementInput, existing?: Pick<SettlementDetail, 'id' | 'revision'>) {
  return write<SettlementDetail>(sourcePath(side, 'settlements', existing?.id), existing ? 'PATCH' : 'POST',
    existing ? { ...input, expectedRevision: existing.revision } : input);
}

export function submitSource(path: string, expectedRevision: number) {
  return write<Approval>(path + '/submit', 'POST', { expectedRevision });
}

export function postSource(path: string, approvalRequestId: string) {
  return write<Pick<CoreJournal, 'id' | 'journalNumber' | 'journalType'>>(path + '/post', 'POST', { approvalRequestId });
}

export function cancelSource(path: string, expectedRevision: number, reason: string) {
  return write<{ id: string; status: 'VOID' }>(path + '/cancel', 'POST', { expectedRevision, reason });
}

export function reverseSource(path: string, accountingDate: string, remark: string) {
  return write<Approval>(path + '/reversal-requests', 'POST', { accountingDate, remark });
}

export function adjustReceivable(path: string, input: AdjustmentInput) {
  return write<Approval>(path + '/adjustments', 'POST', input);
}

export function matchSettlement(path: string, bankTransactionId: string, remark: string) {
  return write<SettlementDetail>(path + '/match', 'POST', { bankTransactionId, remark });
}
