export type StatementLifecycleStatus = "RAW" | "CHECK" | "FINALIZED";
export type TransactionDirection = "CR" | "DB";
export type DraftRowStatus = "MATCHED" | "READY" | "NEEDS_REVIEW" | "NOT_APPLICABLE";
export type DraftRowStatusFilter = "ALL" | DraftRowStatus;

export type EventCodeOption = {
  id: string;
  code: string;
  eventName: string;
};

export type BankAccountOption = {
  id: string;
  label: string;
  accountNo: string;
};

export type StatementDraft = {
  id: string;
  bankAccountId: string;
  bankAccountLabel: string;
  accountNo: string;
  fileName: string;
  periodFrom: string | null;
  periodTo: string | null;
  totalTransaction: number;
  totalCredit: string;
  totalDebit: string;
  status: StatementLifecycleStatus;
  uploadedAt: string;
  uploadedBy: string;
  rejectionRemark?: string | null;
  overlaps: Array<{
    id: string;
    fileName: string;
    periodFrom: string | null;
    periodTo: string | null;
    status: StatementLifecycleStatus;
  }>;
};

export type StatementDraftListItem = {
  id: string;
  bankAccountLabel: string;
  accountNo: string;
  fileName: string;
  periodFrom: string | null;
  periodTo: string | null;
  totalTransaction: number;
  needsReview: number;
  uploadedBy: string;
  uploadedAt: string;
  status: "RAW";
};

export type DraftTransaction = {
  id: string;
  rowNo: number;
  transactionDate: string;
  transactionType: string;
  direction: TransactionDirection;
  referenceNo?: string | null;
  senderName?: string | null;
  description: string;
  originalAmount: string;
  suffixCode?: string | null;
  suggestedEventCodeId?: string | null;
  eventCodeId?: string | null;
  baseAmount?: string | null;
  remark?: string | null;
  requiresClassification: boolean;
};

export type StatementUploadSummary = {
  draftStatements: number;
  totalTransactions: number;
  needsReview: number;
  readyForSubmission: number;
};

export type StatementUploadWorkspace = {
  summary: StatementUploadSummary;
  drafts: StatementDraftListItem[];
  statement: StatementDraft | null;
  transactions: DraftTransaction[];
  eventCodes: EventCodeOption[];
  bankAccounts: BankAccountOption[];
};

export type UpdateFinalEventInput = {
  statementId: string;
  transactionId: string;
  eventCodeId: string | null;
};

export type UpdateFinalEventResponse = {
  transaction: DraftTransaction;
  summary: StatementUploadSummary;
};

export type UploadStatementInput = {
  bankAccountId: string;
  file: File;
};
