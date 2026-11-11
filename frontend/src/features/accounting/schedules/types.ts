import type { Approval, ApprovalDetail, CoreJournal } from '../core/types';
import type { DocumentRow } from '../apar/types';

export const allocationMethods = ['MONTHLY_EQUAL', 'ACTUAL_DAYS', 'CUSTOM'] as const;
export type AccrualKind = 'ACCRUED_EXPENSE' | 'ACCRUED_INCOME';
export type ScheduleKind = 'PREPAYMENT' | 'DEFERRED_INCOME';
export type AccrualMetadata = {
  kind: AccrualKind;
  serviceStart: string;
  serviceEnd: string;
  supportingEvidence: string;
  policyReference: string;
  recognitionBasis: string;
  scheduledReversalOn: string | null;
};
export type AccrualInput = {
  sourceReference: string;
  accountingDate: string;
  amount: string;
  recognitionAccountId: string;
  balanceAccountId: string;
  counterpartyId: string | null;
  metadata: AccrualMetadata;
};
export type AccrualAdjustment = Pick<AccrualInput, 'sourceReference' | 'accountingDate' | 'amount'> & {
  adjustmentKind: 'INCREASE' | 'DECREASE';
  reason: string;
};
type SourceHeader = { id: string; revision: number; status: string; createdById: string };
type DraftLine = { id: string; accountId: string; debit: string; credit: string; counterpartyId: string | null };
type LinkedJournal = Pick<CoreJournal, 'id' | 'journalNumber' | 'accountingDate'> & {
  revFkAccJournalReversal: Pick<CoreJournal, 'id' | 'journalNumber'> | null;
};
export type AccrualRow = SourceHeader & {
  sourceReference: string;
  accountingDate: string;
  accrualMetadata: AccrualMetadata;
  postedJournalId: string | null;
};
export type AdjustmentRow = Omit<AccrualRow, 'accrualMetadata'> & {
  accrualMetadata: AccrualMetadata & Pick<AccrualAdjustment, 'adjustmentKind' | 'reason'>;
};
export type RetainedApproval = Approval & { history?: ApprovalDetail['history'] };
export type ApprovalResult = { approvalId?: string };
export type Accrual = AccrualRow & {
  metadata: AccrualMetadata;
  balance: DraftLine;
  recognition: DraftLine;
  postedJournal: LinkedJournal | null;
  originalAmount: string;
  recognized: string;
  cleared: string;
  remaining: string;
  reconciliation: string;
  controlReconciliation: { generalLedger: string; subledger: string; reconciled: boolean; variance: string };
  clearingDocuments: Pick<DocumentRow, 'id' | 'documentKind' | 'documentNumber' | 'recognitionJournalId' | 'status'>[];
  adjustments: AdjustmentRow[];
  approvalHistory: RetainedApproval[];
  relatedRecordsLimit: number;
};
export type DueReversals = {
  asOf: string;
  page: number;
  pageSize: number;
  rows: { id: string; scheduledDate: string }[];
  postingAutomatic: false;
};
export type PlanRow = { accountingPeriodId: string; recognitionDate: string; plannedAmount: string };
export type PlanInput = {
  amount: string;
  startDate: string;
  endDate: string;
  allocationMethod: typeof allocationMethods[number];
  customPeriods?: PlanRow[];
};
export type PlanPreview = PlanInput & { periods: PlanRow[]; postingAutomatic: false };
export type ScheduleInput = PlanInput & {
  scheduleReference: string;
  scheduleKind: ScheduleKind;
  sourceJournalLineId: string;
  recognitionAccountId: string;
  policyEvidence: string;
  recognitionBasis: string;
};
export type ScheduleCommand =
  | { action: 'SETUP' }
  | { action: 'CHANGE'; periods: PlanRow[]; reason: string }
  | { action: 'CANCEL'; reason: string }
  | { action: 'TERMINATE'; accountingDate: string; reason: string };
export type SchedulePeriod = PlanRow & {
  id: string;
  accountingScheduleId: string;
  recognitionJournalId: string | null;
  relFkAccSchedulePeriodJournal?: LinkedJournal | null;
};
export type ScheduleRow = SourceHeader & Pick<ScheduleInput, 'scheduleReference' | 'scheduleKind' | 'sourceJournalLineId' |
  'recognitionAccountId' | 'policyEvidence' | 'recognitionBasis' | 'startDate' | 'endDate' | 'allocationMethod'> & {
  balanceAccountId: string;
  plannedAmount: string;
  accountingDocumentId: string | null;
  terminationJournalId: string | null;
};
export type ScheduleSource = ScheduleRow & {
  revFkAccSchedulePeriodParent: SchedulePeriod[];
  relFkAccScheduleSource: { id: string; journalId: string; journal: LinkedJournal & Pick<CoreJournal, 'sourceKind'> };
  terminationJournal: LinkedJournal | null;
};
export type Schedule = ScheduleSource & {
  recognized: string;
  terminated: string;
  remaining: string;
  controlReconciliation: { generalLedgerRemaining: string; reconciled: boolean };
  approvalHistory: RetainedApproval[];
  approvalHistoryLimit: number;
  policyStatus: string;
  postingAutomatic: false;
};
