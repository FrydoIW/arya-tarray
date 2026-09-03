export type EditIncomeDisplayStatus = "COMPLETE" | "PENDING_REAPPROVAL";
export type EditIncomePeriodMode = "MONTH" | "DAY";
export type EditIncomeStatusFilter = "ALL" | EditIncomeDisplayStatus;
export type CorrectionRowStatus = "CURRENT" | "MODIFIED" | "NOT_APPLICABLE";
export type CorrectionRowStatusFilter = "ALL" | CorrectionRowStatus;

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
};

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
  baseAmount: string | null;
  remark: string | null;
  requiresClassification: boolean;
};

export type EditIncomeDetail = {
  statement: EditIncomeStatement & {
    finalizedBy: { id: string; fullName: string } | null;
  };
  eventCodes: EditIncomeEventCode[];
  transactions: EditIncomeTransaction[];
  approvalHistory: Array<{
    id: string;
    action: string;
    remark: string | null;
    actionAt: string;
    actionBy: { id: string; fullName: string };
  }>;
};

export type EditIncomeCorrectionChange = {
  transactionId: string;
  eventCodeId: string | null;
  remark: string | null;
};

export type ExecuteEditIncomeResponse = {
  statementId: string;
  approvalId: string;
  modifiedTransactions: number;
  status: "CHECK";
  message: string;
};
