import type { AccountingPage } from '../types';

export type ReconciliationException = { code: string; severity?: string; sourceId?: string; amount?: string; reason?: string };
export type ControlRow = { accountId: string; subledger: string; generalLedger: string; difference: string };
export type ControlReconciliation = {
  scope: string; asOf: string; controlAccounts?: string[]; rows?: ControlRow[];
  subledgerTotal?: string; glTotal?: string; difference?: string; status: string; severity?: string;
  exceptions: ReconciliationException[]; evidence?: string; truncated?: boolean;
  components?: { cost: string; accumulatedDepreciation: string; impairment: string; netCarryingValue: string; depreciationExpenseBeforeAnnualClosing: string };
};
export type FundReconciliation = {
  scope: string; asOf: string; status: string; truncated: boolean; exceptions: ReconciliationException[];
  controls: Array<{ fundId: string; classified: string; released: string; remaining: string; glNetResources: string; difference: string }>;
  conditionalControls: Array<{ fundId: string; sourceClassifications: string; approvedAdjustments: string; generalLedger: string; difference: string }>;
  internalDesignations: Array<{ fundId: string; designated: string; managementAvailable: string; financialJournalCreated: false }>;
  financialSource: string;
};
export type SubledgerBundle = { asOf: string; ap: ControlReconciliation; ar: ControlReconciliation; assets: ControlReconciliation; accruals: ControlReconciliation; funds: FundReconciliation; status: string };

export type BankReconciliationRow = {
  id: string; bankAccountId: string; bankGlAccountId: string; accountingPeriodId: string; statementUploadId: string | null;
  reconciliationReference: string; reconciliationDate: string; statementOpeningBalance: string; statementClosingBalance: string;
  status: string; revision: number; evidence: unknown; closedAt: string | null; closedById: string | null; createdById: string; createdAt: string; updatedAt: string;
};
export type BankMovement = { id: string; amount: string; direction: 'IN' | 'OUT'; journalId?: string };
export type BankMatch = { id: string; bankReconciliationId: string; bankTransactionId: string; accountingJournalLineId: string; matchedAmount: string; matchStatus: string; matchedById: string; matchedAt: string; voidedAt: string | null; voidedById: string | null };
export type BankReconciliationDetail = {
  id: string; workflowStatus: string; scope: { bankAccountId: string; bankGlAccountId: string; periodId: string; from: string; to: string };
  revision: number; status: string; statementOpening: string; statementMutations: string; statementClosing: string; statementDifference: string;
  glOpening: string; glClosing: string; timingAdjustment: string; adjustedBankBalance: string; adjustedGLBalance: string; difference: string;
  unmatchedBank: BankMovement[]; unmatchedGL: BankMovement[]; matchedTransactions: BankMatch[]; exceptions: ReconciliationException[];
  evidence: { openingEvidence: string; statementEvidence: string; timingItems: Array<{ kind: 'OUTSTANDING_PAYMENT' | 'DEPOSIT_IN_TRANSIT'; journalLineId: string; amount: string; evidence: string }> };
  sourceFingerprint: string;
};
export type BankReconciliationPage = AccountingPage<BankReconciliationRow>;

export type CloseItem = { control: string; status: 'PASS' | 'FAIL' | 'WARNING' | 'NOT_APPLICABLE' | 'PENDING_REVIEW'; evidence: unknown };
export type ClosingPreview = {
  type: 'PERIOD' | 'YEAR'; sourceId: string; fiscalYearId: string; revision: number; from: string; to: string; status: 'READY' | 'NOT_READY';
  items: CloseItem[]; subledgers: SubledgerBundle; annualCoverage: { complete: boolean; missing: string[] } | null; financialFingerprint: string;
  reports: { status: string; exceptions: string[]; trialBalance: { balanced: boolean; difference: string } };
};
export type IntegrityControl = { control: string; pass: boolean; difference: string | null; evidence: unknown; status: string; severity: string; suggestedInvestigation: string | null };
export type FinancialIntegrity = { scope: { fiscalYearId: string; from: string; to: string }; status: string; controls: IntegrityControl[]; postedJournalFingerprint: string; frameworkReference: string | null; automaticAdjustment: false };
export type ClosingRequestResult = { command: { id: string; revision: number; sourceRevision: number; sourceKind: string; status: string }; approval: { id: string; status: string; requestKind: string } };
