export type DashboardMetricValue = {
  value: number;
  changePercent: number | null;
};

export type DashboardMoneyMetricValue = {
  value: string;
  changePercent: number | null;
};

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
    month: string;
    monthLabel: string;
  };
  metrics: {
    totalStatements: DashboardMetricValue;
    totalTransactions: DashboardMetricValue;
    totalIncoming: DashboardMoneyMetricValue;
    totalOutgoing: DashboardMoneyMetricValue;
    completeTransactions: DashboardMetricValue;
  };
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
  topFinalEvents: Array<{
    eventCodeId: string;
    code: string;
    eventName: string;
    transactions: number;
    amount: string;
  }>;
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
