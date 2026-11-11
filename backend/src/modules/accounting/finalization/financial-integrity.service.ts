import type { Prisma } from "@prisma/client";
import type { ReportQuery } from "./finalization.schema.js";
import { statementsInTransaction } from "./reporting.service.js";
import { allSubledgers } from "./reconciliation.service.js";
import { integrityJournalChecks } from "./closing.service.js";
import { currentPolicy, day, readAccounting } from "./finalization.repository.js";
import { bankReviewControl } from "./bank-reconciliation.service.js";
export async function integrityInTransaction(tx: Prisma.TransactionClient, q: ReportQuery) {
  const [report, subs, journals, policy, banks, duplicates] = await Promise.all([statementsInTransaction(tx, q), allSubledgers(tx, q.fiscalYearId, q.to), integrityJournalChecks(tx, day(q.to)), currentPolicy(tx, q.fiscalYearId), bankReviewControl(tx, q.fiscalYearId, day(q.from), day(q.to)),
    tx.$queryRaw<{ id: string; reason: string }[]>`SELECT s.accounting_settlement_id AS id,'DUPLICATE_BANK_RECOGNITION' AS reason FROM arya_accounting_settlement s JOIN arya_accounting_journal j ON j.accounting_journal_id=s.posting_journal_id JOIN arya_accounting_journal b ON b.bank_transaction_id=s.bank_transaction_id AND b.source_kind='FINALIZED_BANK_TRANSACTION' WHERE j.accounting_date<=${day(q.to)} AND b.accounting_date<=${day(q.to)} AND NOT EXISTS(SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id AND r.accounting_date<=${day(q.to)}) AND NOT EXISTS(SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=b.accounting_journal_id AND r.accounting_date<=${day(q.to)})
    UNION ALL SELECT s.accounting_settlement_id,'SETTLEMENT_ALLOCATION_DIFFERENCE' FROM arya_accounting_settlement s JOIN arya_accounting_journal j ON j.accounting_journal_id=s.posting_journal_id LEFT JOIN arya_accounting_settlement_allocation a USING(accounting_settlement_id) WHERE j.accounting_date<=${day(q.to)} AND NOT EXISTS(SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id AND r.accounting_date<=${day(q.to)}) GROUP BY s.accounting_settlement_id HAVING COALESCE(SUM(a.allocated_amount),0)<>MAX(s.amount)
    UNION ALL SELECT sourceId,'DUPLICATE_CAPITALIZATION_SOURCE' FROM (SELECT acquisition_journal_line_id AS sourceId FROM arya_accounting_fixed_asset WHERE status IN ('ACTIVE','DISPOSED','WRITTEN_OFF') UNION ALL SELECT asset_source_line_id FROM arya_accounting_journal_draft WHERE source_kind='ASSET_CHANGE' AND status='APPLIED' AND JSON_UNQUOTE(JSON_EXTRACT(asset_metadata,'$.action'))='ADDITIONAL') src GROUP BY sourceId HAVING COUNT(*)>1 LIMIT 101`]);
  const rollforward = Object.values(report.changesInNetAssets).every(r => r.rollforwardDifference === "0.00");
  const controls = [
    { control: "JOURNAL_DEBIT_EQUALS_CREDIT", pass: journals.balanceValid, difference: null, evidence: journals.exceptions },
    { control: "TRIAL_BALANCE", pass: report.trialBalance.balanced, difference: report.trialBalance.difference, evidence: report.ledgerFingerprint },
    { control: "FINANCIAL_POSITION_EQUATION", pass: report.financialPosition.balanced, difference: report.financialPosition.difference, evidence: report.financialPosition },
    ...(["ap", "ar", "assets", "accruals", "funds"] as const).map(k => ({ control: `${k.toUpperCase()}_SUBLEDGER_GL`, pass: ["BALANCED", "NOT_APPLICABLE"].includes(subs[k].status), difference: "difference" in subs[k] ? subs[k].difference : null, evidence: subs[k] })),
    { control: "BANK_RECONCILIATION_REVIEW", pass: ["VERIFIED", "NOT_APPLICABLE"].includes(banks.status), difference: null, evidence: banks },
    { control: "CASHFLOW_TO_GL_CASH", pass: report.cashFlows.status === "VERIFIED" && report.cashFlows.difference === "0.00", difference: report.cashFlows.difference, evidence: report.cashFlows },
    { control: "OPENING_CLOSING_NET_ASSET_ROLLFORWARD", pass: rollforward, difference: rollforward ? "0.00" : null, evidence: report.changesInNetAssets },
    { control: "POSTED_JOURNAL_IMMUTABILITY_SEALS", pass: journals.seals.valid, difference: null, evidence: journals.seals },
    { control: "CLOSED_PERIOD_POSTING_AUTHORITY", pass: journals.periodValid, difference: null, evidence: journals.exceptions },
    { control: "DONOR_RELEASE_NO_NEW_CASH_OR_EXPENSE", pass: journals.releaseValid, difference: null, evidence: journals.exceptions },
    { control: "NO_DUPLICATE_CONTRIBUTION_RECOGNITION", pass: !duplicates.some(d => d.reason === "DUPLICATE_BANK_RECOGNITION"), difference: null, evidence: duplicates.filter(d => d.reason === "DUPLICATE_BANK_RECOGNITION") },
    { control: "NO_DOUBLE_SETTLEMENT_OR_CAPITALIZATION", pass: !duplicates.some(d => d.reason !== "DUPLICATE_BANK_RECOGNITION"), difference: null, evidence: duplicates.filter(d => d.reason !== "DUPLICATE_BANK_RECOGNITION") },
    { control: "REPORT_MAPPINGS_AND_POLICY", pass: report.status === "DRAFT_VERIFIED", difference: null, evidence: report.exceptions }
  ].map(c => ({ ...c, status: c.pass ? "PASS" : "UNVERIFIED", severity: c.pass ? "NONE" : "ERROR", suggestedInvestigation: c.pass ? null : "Review source references, mappings, cut-off, reversal and approval evidence; do not add a balancing plug." }));
  return { scope: q, status: controls.every(c => c.pass) ? "VERIFIED" : "UNVERIFIED", controls, postedJournalFingerprint: report.ledgerFingerprint, frameworkReference: policy.policy?.frameworkReference ?? null, automaticAdjustment: false };
}
export const financialIntegrity = (actor: string, q: ReportQuery) => readAccounting(actor, tx => integrityInTransaction(tx, q));
