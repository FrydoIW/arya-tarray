import type { EventType } from "@/lib/event-type";

export type StatementLifecycleStatus = "RAW" | "CHECK" | "FINALIZED";
export type TransactionDirection = "CR" | "DB";
export type DraftRowStatus = "MATCHED" | "READY" | "NEEDS_REVIEW" | "NOT_APPLICABLE";
export type DraftRowStatusFilter = "ALL" | DraftRowStatus;

export type EventCodeOption = {
  id: string;
  code: string;
  eventName: string;
  eventType: EventType;
  timeRule?: { unitAmount: string; durationMonths: number; activeFlag: boolean } | null;
};

export type CampaignOption = { id: string; eventCodeId: string; campaignName: string; startDate: string | null; endDate: string | null; activeFlag: boolean };

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
  eventCampaignId?: string | null;
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
  campaigns: CampaignOption[];
  bankAccounts: BankAccountOption[];
};

export type UploadDuplicateDetail = {
  matchedStatementUploadId: string;
  matchedStatementFileName: string | null;
  matchedBankTransactionId: string;
  sourceTransactionNo: number;
  sourceWorksheetRow: number | null;
  sourceSheetName: string | null;
  transactionDate: string | null;
  transactionType: string | null;
  referenceNo: string | null;
  senderName: string | null;
  description: string | null;
  originalAmount: string;
  signatureHash: string;
};

export type UploadAttemptResult = {
  attemptId: string;
  sourceTransactions: number;
  importedTransactions: number;
  duplicateTransactions: number;
  sourceTotalCredit: string;
  sourceTotalDebit: string;
  duplicates: UploadDuplicateDetail[];
};

export type StatementUploadResponse = StatementUploadWorkspace & { uploadResult: UploadAttemptResult };

export type WithdrawStatementResponse = StatementUploadWorkspace & {
  withdrawal: {
    statementId: string;
    remainingStatementCount: number;
    openingBalanceUnlocked: boolean;
  };
};

export type UpdateFinalEventInput = {
  statementId: string;
  transactionId: string;
  eventCodeId: string | null;
  eventCampaignId: string | null;
  remark?: string | null;
};

export type UpdateFinalEventResponse = {
  transaction: DraftTransaction;
  summary: StatementUploadSummary;
};

export type UploadStatementInput = {
  bankAccountId: string;
  file: File;
};
