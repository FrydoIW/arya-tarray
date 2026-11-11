import type { accountTypes, normalBalances } from "./core/contracts.generated";
export type AccountingView = "journals" | "ledger" | "trial" | "monthly" | "reconciliation" | "pending";
export type AccountingRow = Record<string, string | number | null>;
export type AccountingReport = {
  view: AccountingView; cutoverDate: string; coverage: string; preview: boolean;
  rows: AccountingRow[]; additions: AccountingRow[]; additionsLimit: number; total: number;
  page: number; pageSize: number; totalDebit: string; totalCredit: string; movementBalance: string; balanced: boolean;
};
export type AccountingOptions = Record<"banks" | "events" | "campaigns" | "members", Array<{ id: string; label: string }>>;
export type JournalDetail = {
  id: string; journalNumber: string; journalType: string; accountingDate: string; postedAt: string;
  sourceEventKey: string; state: string; relatedJournalId: string | null; descriptionSnapshot: string | null;
  correctionItem: { id: string; proposalId: string; action: string } | null;
  linkedJournals: Array<{ id: string; journalNumber: string; journalType: string }>;
  bankTransaction: { id: string; rowNo: number | null; referenceNo: string | null;
    statementUpload: { id: string; fileName: string; status: string; approval: { id: string; status: string } | null } } | null;
  lines: AccountingRow[];
};

export type AccountingPage<T> = { rows: T[]; total: number; page: number; pageSize: number };
export type AccountingAccount = {
  id: string; code: string; name: string; parentAccountId: string | null;
  accountType: typeof accountTypes[number];
  accountClassification: string | null; reportSection: string | null; normalBalance: typeof normalBalances[number];
  contraFlag: boolean; postingFlag: boolean; activeFlag: boolean; createdAt: string; updatedAt: string;
  _count: { lines: number };
};
export type AccountingPeriod = { id: string; fiscalYearId: string; periodNo: number; periodCode: string;
  startDate: string; endDate: string; status: string; revision: number; closedAt: string | null; closedById?: string | null; closingDraftId?: string | null };
export type AccountingFiscalYear = { id: string; yearCode: string; startDate: string; endDate: string;
  status: string; revision: number; closedAt?: string | null; closedById?: string | null; closingDraftId?: string | null; reportingPolicyDraftId?: string | null; revFkAccPeriodFy: AccountingPeriod[] };
export type AccountingApproval = { id: string; requestKind: string; sourceDocumentId: string; status: string;
  requestedById: string; requestedAt: string };
