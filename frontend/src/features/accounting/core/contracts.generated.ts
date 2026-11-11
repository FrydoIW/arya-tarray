// Generated from backend coa/approval schemas by scripts/sync-accounting-contract.mjs.
export const accountTypes = ["ASSET","LIABILITY","NET_ASSET","REVENUE","EXPENSE"] as const;
export const normalBalances = ["DEBIT","CREDIT"] as const;
export const draftJournalTypes = ["MANUAL","ADJUSTMENT"] as const;
export const approvalStatuses = ["PENDING","APPROVED","REJECTED","CANCELLED","SUPERSEDED","APPLIED"] as const;
export const journalPermissions = {"manage":"ACCOUNTING_JOURNAL_MANAGE","approve":"ACCOUNTING_JOURNAL_APPROVE","post":"ACCOUNTING_JOURNAL_POST"} as const;
