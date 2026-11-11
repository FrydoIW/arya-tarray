import type { SubledgerBundle } from '../finalization/types';

export type StatementKind = 'position' | 'income' | 'net-assets' | 'cash-flows' | 'supporting-schedules';
export type ReportScope = {
  fiscalYearId: string;
  from: string;
  to: string;
  comparativeFrom?: string;
  comparativeTo?: string;
  accountingFundId?: string;
  eventCampaignId?: string;
};
export type ReportMapping = {
  section: string;
  statementLine: string;
  incomeClass: string | null;
  netAssetClass: string | null;
  cashEquivalent: boolean;
  cashFlowActivity: string | null;
};
export type PositionLine = { accountId: string; section: string; line: string; amount: string };
export type CashFlowActivities = { OPERATING: string; INVESTING: string; FINANCING: string };
export type CashFlowSource = {
  journalId: string;
  cashMovement: string;
  allocations: Array<{ activity: string; amount: string; sourceId: string }>;
};
export type CashFlowStatement = {
  status: string;
  method: string | null;
  opening: string | null;
  closing: string | null;
  netMovement: string | null;
  difference: string | null;
  activities: CashFlowActivities | null;
  exceptions: string[];
  sources: CashFlowSource[];
};
export type FinancialPositionStatement = {
  assets: string;
  liabilities: string;
  permanentNetAssets: string;
  undistributedSurplusDeficit: string;
  totalNetAssets: string;
  difference: string;
  balanced: boolean;
  netAssetClasses: Record<string, string>;
  lines: PositionLine[];
  undistributedSurplusLine: { section: string; amount: string };
};
export type ComprehensiveIncomeStatement = {
  surplusDeficit: string;
  categories: Record<string, string>;
  recognizedIncome: string;
  recognizedExpenses: string;
  incomeCategories: Record<string, string>;
  expenseCategories: Record<string, string>;
  closingEntriesExcluded: boolean;
};
export type NetAssetMovement = {
  opening: string;
  surplusDeficit: string;
  otherMovements: string;
  closing: string;
  rollforwardDifference: string;
};
export type TrialBalanceReportRow = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  normalBalance: string;
  activeFlag: boolean;
  postingFlag: boolean;
  contraFlag: boolean;
  mapping: ReportMapping | null;
  openingDebit: string;
  openingCredit: string;
  debit: string;
  credit: string;
  closingDebit: string;
  closingCredit: string;
  signedClosingDebit: string;
};
export type FinancialReport = {
  scope: ReportScope;
  status: string;
  official: false;
  fiscalYearRevision: number;
  policyId: string | null;
  policyReference: string | null;
  exceptions: string[];
  trialBalance: {
    balanced: boolean;
    difference: string;
    periodDebit: string;
    periodCredit: string;
    rows: TrialBalanceReportRow[];
  };
  financialPosition: FinancialPositionStatement;
  comprehensiveIncome: ComprehensiveIncomeStatement;
  changesInNetAssets: Record<string, NetAssetMovement>;
  cashFlows: CashFlowStatement;
  ledgerFingerprint: string;
  basis: string;
  comparative: FinancialReport | ComparativeUnavailable | null;
};
export type ComparativeUnavailable = { status: string; exceptions: string[] };
export type ReportingPolicy = {
  policyReference: string;
  frameworkReference: string;
  cashFlowMethod: string;
  materiality: string;
  cutoverCoverageEvidence: string;
  openingBalanceEvidence: string;
  mappings: Array<ReportMapping & { accountId: string }>;
  bankAccounts: Array<{ bankAccountId: string; glAccountId: string; openingEvidence: string }>;
  controls: { payable: string[]; receivable: string[] };
  annual: { policyReference: string; unrestrictedAccountId: string; restrictedAccountId: string } | null;
};
export type SupportingSchedules = {
  scope: ReportScope;
  policy: ReportingPolicy | null;
  subledgers: SubledgerBundle;
  report: FinancialReport;
  narrativeStatus: string;
};

export function comparativeReport(value: unknown): FinancialReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<FinancialReport>;
  return candidate.financialPosition && candidate.comprehensiveIncome && candidate.changesInNetAssets && candidate.cashFlows
    ? candidate as FinancialReport
    : null;
}
export function comparativeStatus(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ComparativeUnavailable>;
  return typeof candidate.status === 'string' ? { status: candidate.status, exceptions: Array.isArray(candidate.exceptions) ? candidate.exceptions : [] } : null;
}
