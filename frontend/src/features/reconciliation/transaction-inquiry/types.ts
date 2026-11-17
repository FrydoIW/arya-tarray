export type TransactionInquiryStatus = "ALL" | "RAW" | "CHECK" | "FINALIZED";
export type TransactionInquiryPeriodMode = "MONTH" | "DAY";
export type TransactionInquiryMemberLinkStatus = "ALL" | "LINKED" | "UNLINKED";

export type TransactionInquiryMember = {
  memberId: string;
  memberCode: string;
  memberName: string;
  memberInitialName: string | null;
  activeFlag: boolean;
};

export type TransactionInquiryMemberIdentity = {
  id: string;
  accountName: string;
  verificationStatus: string;
};

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
  activeFlag: boolean;
  eventType?: string;
};

export type TransactionInquiryCampaign = { id: string; eventCodeId: string; campaignName: string; activeFlag: boolean };

export type TransactionInquiryEventCodeChild = {
  id: string;
  eventCodeId: string;
  childCode: string;
  childName: string;
  activeFlag: boolean;
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
  sourceType: string;
  correctionReason: string | null;
  manualAddedAt: string | null;
  suggestedEvent: TransactionInquiryEvent | null;
  finalEvent: TransactionInquiryEvent | null;
  eventCodeChild: TransactionInquiryEventCodeChild | null;
  eventCampaign: TransactionInquiryCampaign | null;
  memberIdentity: TransactionInquiryMemberIdentity | null;
  member: TransactionInquiryMember | null;
  bankAccount: TransactionInquiryBankAccount;
  itemSale: { purchaseId: string; quantity: number; unitPrice: string; totalAmount: string; paymentAmount: string | null; status: string; resolutionReason: string | null; confirmedAt: string | null; reversedAt: string | null } | null;
};

export type TransactionInquiryWorkspace = {
  filters: {
    periodMode: TransactionInquiryPeriodMode;
    month: string;
    date: string;
    search: string;
    status: TransactionInquiryStatus;
    bankAccountId: string | null;
    finalEventId: string | null;
    eventCodeChildId: string | null;
    eventCampaignId: string | null;
    memberId: string | null;
    memberLinkStatus: TransactionInquiryMemberLinkStatus;
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
  eventOptions: TransactionInquiryEvent[];
  eventCodeChildOptions: TransactionInquiryEventCodeChild[];
  campaignOptions: TransactionInquiryCampaign[];
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
    sourceType: string;
    correctionReason: string | null;
    manualAddedAt: string | null;
    manualAddedBy: { id: string; fullName: string } | null;
    reconciliationExcludedAt: string | null;
    reconciliationExcludedBy: { id: string; fullName: string } | null;
    reconciliationExclusionReason: string | null;
    suggestedEvent: TransactionInquiryEvent | null;
    finalEvent: TransactionInquiryEvent | null;
    eventCodeChild: TransactionInquiryEventCodeChild | null;
    eventCampaign: TransactionInquiryCampaign | null;
    memberIdentity: TransactionInquiryMemberIdentity | null;
    member: TransactionInquiryMember | null;
    sponsorship: { unitAmount: string; durationMonths: number; grantedMonths: number; principalAmount: string; paymentCredited: string | null; paymentOnlyRemainder: string; carryBalanceAfterPayment: string | null; allocation: { referenceNo: string | null; displayName: string | null; coverageFrom: string | null; coverageTo: string | null } | null } | null;
    itemSale: { purchaseId: string; quantity: number; unitPrice: string; totalAmount: string; paymentAmount: string | null; status: string; resolutionReason: string | null; confirmedAt: string | null; confirmedBy: { id: string; fullName: string } | null; reversedAt: string | null; reversedBy: { id: string; fullName: string } | null; movements: Array<{ id: string; movementType: string; quantityDelta: number; stockBefore: number; stockAfter: number; reason: string; createdAt: string; createdBy: { id: string; fullName: string } }> } | null;
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
  periodMode: TransactionInquiryPeriodMode;
  month: string;
  date: string;
  search: string;
  status: TransactionInquiryStatus;
  bankAccountId: string;
  finalEventId: string;
  eventCodeChildId: string;
  eventCampaignId: string;
  memberId: string;
  memberLinkStatus: TransactionInquiryMemberLinkStatus;
  page: number;
  pageSize: number;
};

export type TransactionInquiryMemberOptions = { members: TransactionInquiryMember[] };

export type TransactionReportOptions = {
  includeFinancialSummary: boolean;
  includeClassificationSummary: boolean;
  includeTransactionDetail: boolean;
};
