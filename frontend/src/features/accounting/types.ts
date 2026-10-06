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
    statementUpload: { id: string; fileName: string; status: string; approval: { id: string; status: string } | null } };
  lines: AccountingRow[];
};
