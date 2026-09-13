export type SignApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | string;
export type SignApprovalStatusFilter = "ALL" | "PENDING" | "APPROVED" | "REJECTED";

export type ApprovalPerson = {
  id: string;
  fullName: string;
};

export type ApprovalBankAccount = {
  id: string;
  bankCode: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  currencyCode: string;
};

export type SignApprovalQueueItem = {
  approvalId: string;
  statement: {
    id: string;
    bankAccount: ApprovalBankAccount;
    periodFrom: string | null;
    periodTo: string | null;
    totalTransaction: number;
    totalAmount: string;
    totalCredit: string;
    totalDebit: string;
    status: string;
    uploadedBy: ApprovalPerson;
  };
  submittedAt: string;
  status: SignApprovalStatus;
  decidedAt: string | null;
  decidedBy: ApprovalPerson | null;
};

export type SignApprovalWorkspace = {
  eligible: boolean;
  summary: {
    pendingApproval: number;
    approvedToday: number;
    rejectedToday: number;
    totalDecided: number;
    legacyPendingApproval: number;
  };
  approvals: SignApprovalQueueItem[];
};

export type ApprovalConfiguredApprover = {
  id: string;
  fullName: string;
  email: string;
};

export type ApprovalEventCode = {
  id: string;
  code: string;
  eventName: string;
};

export type ApprovalTransactionPreview = {
  id: string;
  rowNo: number | null;
  transactionDate: string | null;
  description: string | null;
  originalAmount: string;
  suggestedEvent: ApprovalEventCode | null;
  finalEvent: ApprovalEventCode | null;
  campaign: { id: string; campaignName: string } | null;
  sponsorship: { unitAmount: string; durationMonths: number; grantedMonths: number } | null;
  status: string;
};

export type ApprovalHistoryItem = {
  id: string;
  action: string;
  remark: string | null;
  actionAt: string;
  actionBy: ApprovalPerson;
};

export type ApprovalCorrectionItem = {
  id: string;
  action: "MODIFIED" | "ADDED" | "EXCLUDED";
  transaction: {
    id: string;
    rowNo: number | null;
    transactionDate: string | null;
    referenceNo: string | null;
    description: string | null;
    originalAmount: string;
    sourceType: string;
  } | null;
  beforeEvent: ApprovalEventCode | null;
  proposedEvent: ApprovalEventCode | null;
  beforeCampaign: { id: string; campaignName: string } | null;
  proposedCampaign: { id: string; campaignName: string } | null;
  beforeRemark: string | null;
  proposedRemark: string | null;
  correctionReason: string | null;
  manualTransactionDate: string | null;
  manualTransactionType: string | null;
  manualDescription: string | null;
  manualOriginalAmount: string | null;
};

export type SignApprovalDetail = {
  approval: {
    id: string;
    status: SignApprovalStatus;
    submittedAt: string;
    submittedBy: ApprovalPerson;
    decidedAt: string | null;
    decidedBy: ApprovalPerson | null;
    remark: string | null;
    canDecide: boolean;
  };
  statement: {
    id: string;
    bankAccount: ApprovalBankAccount;
    periodFrom: string | null;
    periodTo: string | null;
    status: string;
    uploadedBy: ApprovalPerson;
    totalTransaction: number;
    totalAmount: string;
  };
  configuredApprovers: ApprovalConfiguredApprover[];
  correctionProposal: {
    id: string;
    status: SignApprovalStatus;
    proposedAt: string;
    proposedBy: ApprovalPerson;
    decidedAt: string | null;
    decidedBy: ApprovalPerson | null;
    originalStatementAmount: string;
    currentOfficialAmount: string;
    proposedCorrectedAmount: string;
    summary: { modifiedTransactions: number; addedAdjustments: number; excludedTransactions: number };
    items: ApprovalCorrectionItem[];
  } | null;
  summary: {
    totalTransactions: number;
    totalAmount: string;
    checkedTransactions: number;
    needsReviewTransactions: number;
  };
  transactionPreview: ApprovalTransactionPreview[];
  history: ApprovalHistoryItem[];
};

export type SignApprovalDecisionResponse = {
  approvalId: string;
  status: SignApprovalStatus;
  decidedAt: string | null;
  decidedBy: ApprovalPerson | null;
  remark: string | null;
  statement: {
    id: string;
    status: string;
  };
};
