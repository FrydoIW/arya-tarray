import type { Approval } from '../core/types';

export type Side = 'ap' | 'ar';
export type Source = 'documents' | 'settlements';
export type CounterpartyType = 'VENDOR' | 'DEBTOR' | 'BOTH';
export type CounterpartyInput = {
  counterpartyCode: string;
  displayName: string;
  counterpartyType: CounterpartyType;
  memberId: string | null;
  activeFlag: boolean;
};
export type Counterparty = CounterpartyInput & { id: string };
export type DocumentLine = {
  accountingAccountId: string;
  description: string;
  amount: string;
  accountingFundId: string | null;
  eventCampaignId: string | null;
};
export type DocumentInput = {
  accrualDraftId: string | null;
  counterpartyId: string;
  controlAccountId: string;
  documentNumber: string;
  sourceReference: string;
  recognitionBasis: string;
  documentDate: string;
  accountingDate: string;
  dueDate: string;
  lines: DocumentLine[];
};
type SourceHeader = {
  id: string;
  createdById: string;
  revision: number;
  status: string;
  counterpartyId: string;
  sourceReference: string;
};
export type DocumentRow = Omit<DocumentInput, 'lines'> & SourceHeader & {
  documentKind: 'PAYABLE' | 'RECEIVABLE';
  originalAmount: string;
  recognitionJournalId: string | null;
  relFkAccDocCounterparty: Pick<Counterparty, 'id' | 'displayName'>;
};
export type Allocation = { accountingDocumentId: string; allocatedAmount: string };
export type DocumentSource = DocumentRow & {
  lines: (DocumentLine & { id: string; lineNo: number })[];
  relFkAccDocCounterparty: Counterparty;
  controlAccount: { code: string; name: string } | null;
};
export type DocumentDetail = DocumentSource & {
  outstanding: string;
  financialState: 'POSTED' | 'REVERSED' | 'UNPOSTED';
  relatedRecordsLimit: number;
  approvals: Approval[];
  allocations: (Allocation & {
    id: string;
    relFkAccAllocationSettlement: Pick<SettlementRow, 'id' | 'settlementReference' | 'settlementDate' | 'status' | 'postingJournalId'>;
  })[];
  adjustments: (Pick<AdjustmentInput, 'adjustmentReference' | 'adjustmentKind' | 'amount' | 'reason'> & {
    id: string;
    adjustmentJournalId: string;
  })[];
};
export type SettlementInput = {
  counterpartyId: string;
  bankAccountId: string;
  bankGlAccountId: string;
  settlementReference: string;
  sourceReference: string;
  settlementDate: string;
  amount: string;
  bankTransactionId: string | null;
  allocations: Allocation[];
};
export type LinkedBank = {
  id: string;
  referenceNo: string | null;
  transactionDate: string | null;
  originalAmount: string;
  status: string;
  statementUpload: { id: string; status: string; fileName: string };
};
export type SettlementRow = Omit<SettlementInput, 'allocations'> & SourceHeader & {
  settlementKind: 'PAYABLE' | 'RECEIVABLE';
  postingJournalId: string | null;
  reconciliationState: string;
  relFkAccSettlementBank: LinkedBank | null;
};
export type SettlementDetail = SettlementRow & {
  bankAccount: { id: string; accountName: string; currencyCode: string };
  bankGlAccount: { id: string; code: string; name: string };
  relFkAccSettlementCp: Counterparty;
  allocations: (Allocation & { id: string })[];
};
export type AdjustmentInput = {
  adjustmentReference: string;
  accountingDate: string;
  adjustmentKind: 'INCREASE' | 'DECREASE';
  amount: string;
  offsetAccountId: string;
  reason: string;
};
export type OutstandingRow = {
  id: string;
  documentNumber: string;
  counterpartyId: string;
  controlAccountId: string;
  accountingDate: string;
  dueDate: string;
  recognitionJournalId: string;
  originalAmount: string;
  adjustmentAmount: string;
  settledAmount: string;
  outstanding: string;
  agingBucket: string;
};
export type Outstanding = {
  rows: OutstandingRow[];
  total: number;
  page: number;
  pageSize: number;
  asOf: string;
  counterpartyId?: string;
  outstanding: string;
  negativeBalanceCount: number;
  aging: { current: string; days1To30: string; days31To60: string; days61To90: string; over90: string };
};
