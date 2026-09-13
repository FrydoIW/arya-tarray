export type DashboardMetricValue = {
  value: number;
  changePercent: number | null;
};

export type DashboardMoneyMetricValue = {
  value: string;
  changePercent: number | null;
};

export type DashboardPeriodMode = "MONTH" | "DAY";

export type DashboardActivityType =
  | "STATEMENT_UPLOADED"
  | "APPROVAL_SUBMITTED"
  | "STATEMENT_FINALIZED"
  | "STATEMENT_RETURNED"
  | "INCOME_EDITED";

export interface DashboardSummary {
  viewer: {
    id: string;
    fullName: string;
    email: string;
  };
  filters: {
    periodMode: DashboardPeriodMode;
    month: string;
    date: string;
    monthLabel: string;
    periodLabel: string;
    comparisonLabel: string;
  };
  metrics: {
    totalStatements: DashboardMetricValue;
    totalTransactions: DashboardMetricValue;
    totalIncoming: DashboardMoneyMetricValue;
    totalOutgoing: DashboardMoneyMetricValue;
    completeTransactions: DashboardMetricValue;
  };
  sponsorshipSummary: { activeSubscriptions: number; expiringSoon: number; expiredSubscriptions: number };
  trend: Array<{
    month: string;
    label: string;
    transactions: number;
    incoming: string;
    outgoing: string;
  }>;
  transactionStatus: {
    draft: number;
    needsReview: number;
    pendingApproval: number;
    complete: number;
    total: number;
  };
  statementStatus: {
    draft: number;
    pendingApproval: number;
    complete: number;
    total: number;
  };
  eventGroups: Array<{
    category: string;
    transactionCount: number;
    totalAmount: string;
    events: Array<{
      eventCodeId: string;
      code: string;
      eventName: string;
      transactionCount: number;
      totalAmount: string;
    }>;
  }>;
  campaigns: Array<{
    id: string;
    campaignName: string;
    eventCode: { code: string; eventName: string };
    startDate: string | null;
    endDate: string | null;
    targetAmount: string | null;
    collectedAmount: string;
    progressPercent: number | null;
    targetReached: boolean;
    displayStatus: "ACTIVE" | "SCHEDULED" | "ENDED" | "CLOSED";
  }>;
  memberSummary: {
    linkedAmount: string;
    contributingMemberCount: number;
    linkedTransactionCount: number;
    linkedIdentityCount: number;
    unlinkedTransactionCount: number;
    unlinkedIdentityCount: number;
    unlinkedObservedAmount: string;
    unverifiedIdentityCount: number;
  };
  topMembers: Array<{
    memberId: string;
    memberCode: string;
    memberName: string;
    activeFlag: boolean;
    transactionCount: number;
    amount: string;
  }>;
  memberEventGroups: Array<{
    category: string;
    memberCount: number;
    transactionCount: number;
    amount: string;
    events: Array<{
      eventCodeId: string;
      eventCode: string;
      eventName: string;
      category: string;
      memberCount: number;
      transactionCount: number;
      amount: string;
    }>;
  }>;
  registrationFollowUp: {
    unverifiedIdentityCount: number;
    identities: Array<{
      memberIdentityId: string;
      accountName: string;
      firstSeenAt: string;
      lastSeenAt: string;
      transactionCount: number;
    }>;
  };
  recentActivities: Array<{
    id: string;
    type: DashboardActivityType;
    title: string;
    detail: string;
    actor: string;
    occurredAt: string;
  }>;
  lastUpdatedAt: string;
}
