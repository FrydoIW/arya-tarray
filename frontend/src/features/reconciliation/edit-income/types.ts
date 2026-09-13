import type { EventType } from "@/lib/event-type";

export type EditIncomeDisplayStatus = "COMPLETE" | "PENDING_REAPPROVAL";
export type EditIncomePeriodMode = "MONTH" | "DAY";
export type EditIncomeStatusFilter = "ALL" | EditIncomeDisplayStatus;
export type EditIncomeMode = "INQUIRY" | "EDIT";
export type CorrectionRowStatus = "CURRENT" | "MODIFIED" | "ADDED" | "EXCLUDED";
export type CorrectionRowStatusFilter = "ALL" | CorrectionRowStatus;
export type CorrectionDirectionFilter = "ALL" | "INCOMING" | "OUTGOING";

export type EditIncomeBankAccount = {
  id: string;
  bankCode: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  currencyCode: string;
};

export type EditIncomeStatement = {
  id: string;
  fileName: string;
  bankAccount: EditIncomeBankAccount;
  periodFrom: string | null;
  periodTo: string | null;
  totalTransaction: number;
  totalAmount: string;
  status: "FINALIZED" | "CHECK";
  displayStatus: EditIncomeDisplayStatus;
  uploadedAt: string;
  uploadedBy: { id: string; fullName: string };
  finalizedAt: string | null;
  approvalStatus: string | null;
  editable: boolean;
};

export type EditIncomeWorkspace = {
  periodMode: EditIncomePeriodMode;
  month: string;
  date: string;
  summary: {
    finalizedStatements: number;
    totalTransactions: number;
    pendingReapproval: number;
  };
  statements: EditIncomeStatement[];
  bankAccounts: EditIncomeBankAccount[];
};

export type EditIncomeEventCode = {
  id: string;
  code: string;
  eventName: string;
  eventType: EventType;
  activeFlag: boolean;
  timeRule?: { unitAmount: string; durationMonths: number; activeFlag: boolean } | null;
};

export type EditIncomeCampaign = { id: string; eventCodeId: string; campaignName: string; startDate: string | null; endDate: string | null; activeFlag: boolean };

export type EditIncomeTransaction = {
  id: string;
  rowNo: number;
  transactionDate: string | null;
  transactionType: string;
  referenceNo: string | null;
  senderName: string | null;
  description: string;
  originalAmount: string;
  suffixCode: string | null;
  suggestedEventCodeId: string | null;
  eventCodeId: string | null;
  eventCampaignId: string | null;
  baseAmount: string | null;
  remark: string | null;
  requiresClassification: boolean;
  sourceType: "BANK" | "MANUAL" | string;
  correctionReason: string | null;
  reconciliationExcludedAt: string | null;
  reconciliationExclusionReason: string | null;
  correctionAction?: "ADDED" | "EXCLUDED";
};

export type EditIncomeDetail = {
  statement: EditIncomeStatement & {
    finalizedBy: { id: string; fullName: string } | null;
  };
  eventCodes: EditIncomeEventCode[];
  campaigns: EditIncomeCampaign[];
  transactions: EditIncomeTransaction[];
  approvalHistory: Array<{
    id: string;
    action: string;
    remark: string | null;
    actionAt: string;
    actionBy: { id: string; fullName: string };
  }>;
};

export type EditIncomeCorrectionRequest =
  | { action: "MODIFIED"; transactionId: string; eventCodeId: string | null; eventCampaignId: string | null; remark: string | null }
  | { action: "EXCLUDED"; transactionId: string; reason: string }
  | {
      action: "ADDED";
      clientId: string;
      direction: "INCOMING" | "OUTGOING";
      transactionDate: string;
      description: string;
      amount: string;
      eventCodeId: string | null;
      eventCampaignId: string | null;
      remark: string | null;
      reason: string;
    };

export type ManualAdjustmentInput = {
  direction: "INCOMING" | "OUTGOING";
  transactionDate: string;
  description: string;
  amount: string;
  eventCodeId: string | null;
  eventCampaignId: string | null;
  remark: string | null;
  reason: string;
};

export type ExecuteEditIncomeResponse = {
  statementId: string;
  approvalId: string;
  proposalId: string;
  modifiedTransactions: number;
  addedAdjustments: number;
  excludedTransactions: number;
  status: "CHECK";
  message: string;
};
