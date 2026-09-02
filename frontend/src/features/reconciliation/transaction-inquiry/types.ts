export type TransactionInquiryStatus = "ALL" | "RAW" | "CHECK" | "FINALIZED";

export type TransactionInquiryBankAccount = {
  id: string;
  bankCode: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  currencyCode: string;
  activeFlag: boolean;
};

export type TransactionInquiryEvent = {
  id: string;
  code: string;
  eventName: string;
};

export type TransactionInquiryRow = {
  id: string;
  statementId: string;
  transactionDate: string | null;
  transactionType: string | null;
  referenceNo: string | null;
  senderName: string | null;
  description: string | null;
  originalAmount: string;
  suffixCode: string | null;
  baseAmount: string | null;
  status: "RAW" | "CHECK" | "FINALIZED";
  displayStatus: string;
  remark: string | null;
  suggestedEvent: TransactionInquiryEvent | null;
  finalEvent: TransactionInquiryEvent | null;
  bankAccount: TransactionInquiryBankAccount;
};

export type TransactionInquiryWorkspace = {
  filters: {
    month: string;
    search: string;
    status: TransactionInquiryStatus;
    bankAccountId: string | null;
  };
  summary: {
    totalTransactions: number;
    totalCredit: string;
    totalDebit: string;
    completeTransactions: number;
    incomingTransactions: number;
    outgoingTransactions: number;
  };
  bankAccounts: TransactionInquiryBankAccount[];
  transactions: TransactionInquiryRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type TransactionInquiryDetail = {
  statement: {
    id: string;
    fileName: string;
    periodFrom: string | null;
    periodTo: string | null;
    status: string;
    displayStatus: string;
    bankAccount: TransactionInquiryBankAccount;
    uploadedBy: { id: string; fullName: string };
    executedBy: { id: string; fullName: string } | null;
    finalizedBy: { id: string; fullName: string } | null;
    approval: { id: string; status: string; submittedAt: string; decidedAt: string | null } | null;
  };
  transaction: {
    id: string;
    transactionDate: string | null;
    transactionType: string | null;
    referenceNo: string | null;
    senderName: string | null;
    description: string | null;
    originalAmount: string;
    suffixCode: string | null;
    baseAmount: string | null;
    status: string;
    displayStatus: string;
    remark: string | null;
    suggestedEvent: TransactionInquiryEvent | null;
    finalEvent: TransactionInquiryEvent | null;
  };
  history: Array<{
    id: string;
    fieldName: string | null;
    oldValue: string | null;
    newValue: string | null;
    oldValueLabel: string | null;
    newValueLabel: string | null;
    remark: string | null;
    changedAt: string;
    changedBy: { id: string; fullName: string };
  }>;
};

export type TransactionInquiryQuery = {
  month: string;
  search: string;
  status: TransactionInquiryStatus;
  bankAccountId: string;
  page: number;
  pageSize: number;
};

export type TransactionReportOptions = {
  includeFinancialSummary: boolean;
  includeClassificationSummary: boolean;
  includeTransactionDetail: boolean;
};
