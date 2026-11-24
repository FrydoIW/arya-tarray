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

export type EventCodeChildOption = {
  id: string;
  eventCodeId: string;
  childCode: string;
  childName: string;
  displayOrder: number;
  activeFlag: boolean;
  capacity: number | null;
  unitAmount: string | null;
  durationMonths: number | null;
  itemSaleUnitPrice?: string | null;
  itemSaleStockOnHand?: number | null;
  itemSaleVersion?: number | null;
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
  eventCodeChildId?: string | null;
  eventCampaignId?: string | null;
  baseAmount?: string | null;
  remark?: string | null;
  excluded: boolean;
  requiresClassification: boolean;
  itemSaleQuantity?: number | null;
  itemSale?: { id: string; quantity: number; unitPrice: string; totalAmount: string; paymentAmount: string; status: string; resolutionReason: string | null } | null;
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
  duplicates: StatementDuplicate[];
  duplicateSummary: { pendingReview: number; exactSkipped: number; resolvedDistinct: number; resolvedDuplicate: number };
  eventCodes: EventCodeOption[];
  eventCodeChildren: EventCodeChildOption[];
  campaigns: CampaignOption[];
  bankAccounts: BankAccountOption[];
};

export type DuplicateTransactionView = {
  id: string;
  rowNo: number | null;
  transactionDate: string | null;
  transactionType: string | null;
  referenceNo: string | null;
  senderName: string | null;
  description: string | null;
  originalAmount: string;
  status: string;
  statementId: string;
  fileName: string;
};

export type StatementDuplicate = {
  id: string;
  matchType: "EXACT" | "POSSIBLE";
  resolutionStatus: "CONFIRMED" | "PENDING_REVIEW" | "DISTINCT" | "DUPLICATE";
  resolutionReason: string | null;
  resolvedAt: string | null;
  resolvedBy: { id: string; fullName: string } | null;
  uploadFileName: string;
  source: {
    transactionNo: number;
    worksheetRow: number | null;
    sheetName: string | null;
    transactionDate: string | null;
    transactionType: string | null;
    referenceNo: string | null;
    senderName: string | null;
    description: string | null;
    originalAmount: string;
  };
  importedTransaction: DuplicateTransactionView | null;
  matchedTransaction: DuplicateTransactionView;
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
  matchType: "EXACT" | "POSSIBLE";
  resolutionStatus: "CONFIRMED" | "PENDING_REVIEW";
};

export type UploadAttemptResult = {
  attemptId: string;
  sourceTransactions: number;
  importedTransactions: number;
  duplicateTransactions: number;
  possibleDuplicateTransactions: number;
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
  eventCodeChildId: string | null;
  eventCampaignId: string | null;
  remark?: string | null;
  itemSaleQuantity?: number | null;
};

export type UpdateFinalEventResponse = {
  transaction: DraftTransaction;
  summary: StatementUploadSummary;
};

export type UploadStatementInput = {
  bankAccountId: string;
  file: File;
};
