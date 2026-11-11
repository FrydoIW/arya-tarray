import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { accountingCutoverDate } from "../accounting.domain.js";
import { assetInclude, assetState } from "../assets/asset.repository.js";
import { depreciationQuote } from "../assets/depreciation.service.js";
import { statementsInTransaction } from "./reporting.service.js";
import { allSubledgers } from "./reconciliation.service.js";
import { verifyPostedLedgerAudits } from "../ledger/ledger-audit.js";
import { bankReviewControl } from "./bank-reconciliation.service.js";
import { pendingClosingApprovals } from "./closing-approval.repository.js";
import { currentPolicy, manageAccounting, readAccounting, yearById, periodById, finalDraft, newFinalDraft, day, dateText, cents, money, material, digest, ledgerFingerprint } from "./finalization.repository.js";
type Item = { control: string; status: "PASS" | "FAIL" | "WARNING" | "NOT_APPLICABLE" | "PENDING_REVIEW"; evidence: unknown };
export async function closePreview(tx: Prisma.TransactionClient, type: "PERIOD" | "YEAR", id: string) {
  const period = type === "PERIOD" ? await periodById(tx, id) : null, year = await yearById(tx, period?.fiscalYearId ?? id), { policy } = await currentPolicy(tx, year.id);
  const start = period?.startDate ?? year.startDate, end = period?.endDate ?? year.endDate, q = { fiscalYearId: year.id, from: dateText(start), to: dateText(end) };
  const [reports, sub, pending, drafts, due, invalid, bankReview, assets, periods, unclassified] = await Promise.all([
    statementsInTransaction(tx, q), allSubledgers(tx, year.id, q.to),
    pendingClosingApprovals(tx, { type, id, from: q.from, to: q.to }),
    tx.$queryRaw<{ n: bigint }[]>`SELECT (SELECT COUNT(*) FROM arya_accounting_document WHERE status='DRAFT' AND accounting_date<=${end})+(SELECT COUNT(*) FROM arya_accounting_settlement WHERE status='DRAFT' AND settlement_date<=${end})+(SELECT COUNT(*) FROM arya_accounting_journal_draft WHERE status='DRAFT' AND source_kind IN ('MANUAL_JOURNAL','ADJUSTING_JOURNAL','ACCRUAL_DOCUMENT','ACCRUAL_ADJUSTMENT','ASSET_JOURNAL','FUND_JOURNAL') AND accounting_date<=${end}) AS n`,
    tx.$queryRaw<{ schedules: bigint; reversals: bigint }[]>`SELECT (SELECT COUNT(*) FROM arya_accounting_schedule_period p JOIN arya_accounting_schedule s USING(accounting_schedule_id) WHERE s.status='ACTIVE' AND p.recognition_date<=${end} AND p.recognition_journal_id IS NULL) AS schedules,
      (SELECT COUNT(*) FROM arya_accounting_journal_draft d JOIN arya_accounting_journal j ON j.accounting_journal_id=d.posted_journal_id WHERE d.source_kind='ACCRUAL_DOCUMENT' AND JSON_EXTRACT(d.accrual_metadata,'$.scheduledReversalOn')<>CAST('null' AS JSON) AND JSON_UNQUOTE(JSON_EXTRACT(d.accrual_metadata,'$.scheduledReversalOn'))<=${q.to} AND NOT EXISTS(SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id AND r.accounting_date<=${end})) AS reversals`,
    integrityJournalChecks(tx, end),
    bankReviewControl(tx, year.id, start, end),
    tx.accountingFixedAsset.findMany({ where: { status: "ACTIVE", inServiceOn: { lte: end } }, include: assetInclude, take: 201 }),
    tx.accountingPeriod.findMany({ where: { fiscalYearId: year.id }, orderBy: { startDate: "asc" } }),
    tx.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM arya_accounting_journal_line l JOIN arya_accounting_journal j USING(accounting_journal_id) WHERE j.source_kind='FINALIZED_BANK_TRANSACTION' AND l.credit>0 AND j.accounting_date<=${end} AND NOT EXISTS(SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id AND r.accounting_date<=${end}) AND (SELECT COALESCE(SUM(y.debit),0) FROM arya_accounting_journal x JOIN arya_accounting_journal_line y ON y.accounting_journal_id=x.accounting_journal_id WHERE x.related_journal_id=j.accounting_journal_id AND x.source_kind IN ('FUND_CLASSIFY','FUND_RESTRICTION') AND y.debit>0 AND y.accounting_account_id=l.accounting_account_id AND x.accounting_date<=${end} AND NOT EXISTS(SELECT 1 FROM arya_accounting_journal rev WHERE rev.reversal_of_journal_id=x.accounting_journal_id AND rev.accounting_date<=${end}))<l.credit`
  ]);
  const items: Item[] = [];
  const add = (control: string, ok: boolean, evidence: unknown, absent = false) => items.push({ control, status: absent ? "NOT_APPLICABLE" : ok ? "PASS" : "FAIL", evidence });
  add("TRIAL_BALANCE", reports.trialBalance.balanced, reports.trialBalance.difference); add("POSTED_JOURNAL_INTEGRITY", invalid.valid, invalid);
  add("BANK_RECONCILIATIONS", ["VERIFIED", "NOT_APPLICABLE"].includes(bankReview.status), bankReview, bankReview.status === "NOT_APPLICABLE");
  add("AP_CONTROL", ["BALANCED", "NOT_APPLICABLE"].includes(sub.ap.status), sub.ap, sub.ap.status === "NOT_APPLICABLE"); add("AR_CONTROL", ["BALANCED", "NOT_APPLICABLE"].includes(sub.ar.status), sub.ar, sub.ar.status === "NOT_APPLICABLE");
  add("ACCRUAL_REVIEW", ["BALANCED", "NOT_APPLICABLE"].includes(sub.accruals.status) && !Number(due[0]?.reversals), { control: sub.accruals, dueReversals: String(due[0]?.reversals ?? 0n) });
  add("PREPAYMENT_AMORTIZATION", !Number(due[0]?.schedules), { duePeriods: String(due[0]?.schedules ?? 0n) });
  const depExceptions: string[] = []; const last = period ?? periods.at(-1);
  for (const a of assets) { if (!last) { depExceptions.push("Missing terminal period"); break; }
    if (assetState(a, end).carrying <= cents(a.residualValue)) continue;
    const posted = a.revFkAccDepRunAssetAsset.some(x => x.accountingPeriodId === last.id && x.relFkAccDepRunAssetRun.postingJournalId && !x.relFkAccDepRunAssetRun.relFkAccDepRunJournal?.revFkAccJournalReversal);
    if (!posted) { try { if (cents(depreciationQuote(a, last).amount) > 0n) depExceptions.push(a.id); } catch { depExceptions.push(a.id); } }
  }
  add("FIXED_ASSET_DEPRECIATION", depExceptions.length === 0 && assets.length <= 200 && ["BALANCED", "NOT_APPLICABLE"].includes(sub.assets.status), { control: sub.assets, missingOrStale: depExceptions, bounded: assets.length <= 200 }, !assets.length && sub.assets.status === "NOT_APPLICABLE");
  add("FUND_RESTRICTIONS", ["BALANCED", "NOT_APPLICABLE"].includes(sub.funds.status), sub.funds, sub.funds.status === "NOT_APPLICABLE");
  add("PENDING_APPROVALS", pending.count === 0, pending); add("UNPOSTED_FINANCIAL_DOCUMENTS", !Number(drafts[0]?.n), { count: String(drafts[0]?.n ?? 0n) });
  items.push({ control: "OPENING_BALANCE_EVIDENCE", status: policy?.openingBalanceEvidence ? "PASS" : "PENDING_REVIEW", evidence: policy?.openingBalanceEvidence ?? "No verified opening/explicit zero-balance evidence." });
  items.push({ control: "POLICY_REVIEW", status: policy ? "PASS" : "PENDING_REVIEW", evidence: policy?.policyReference ?? "PENDING_POLICY" });
  add("UNCLASSIFIED_BANK_CONTRIBUTIONS", !Number(unclassified[0]?.n), { count: String(unclassified[0]?.n ?? 0n) }); add("REPORT_MAPPINGS_AND_EQUATIONS", reports.status === "DRAFT_VERIFIED", reports.exceptions);
  let annualCoverage: { complete: boolean; missing: string[] } | null = null;
  if (type === "YEAR") {
    let cursor = new Date(Math.max(year.startDate.getTime(), accountingCutoverDate().getTime())); const missing: string[] = [];
    for (const p of periods.filter(p => p.endDate >= cursor)) { if (p.startDate.getTime() !== cursor.getTime() || p.status !== "CLOSED") missing.push(p.periodCode); cursor = new Date(p.endDate.getTime() + 86400000); }
    if (cursor.getTime() !== year.endDate.getTime() + 86400000) missing.push("INCOMPLETE_FISCAL_PERIOD_COVERAGE");
    annualCoverage = { complete: missing.length === 0 && Boolean(policy?.cutoverCoverageEvidence), missing }; add("ALL_PERIODS_CLOSED_CUTOVER_COVERAGE", annualCoverage.complete, annualCoverage);
    items.push({ control: "ANNUAL_CLOSING_POLICY", status: policy?.annual ? "PASS" : "PENDING_REVIEW", evidence: policy?.annual ?? "PENDING_POLICY: no annual net-asset closing mapping adopted." });
  }
  return { type, sourceId: id, fiscalYearId: year.id, revision: period?.revision ?? year.revision, from: q.from, to: q.to, status: items.every(i => ["PASS", "NOT_APPLICABLE"].includes(i.status)) ? "READY" : "NOT_READY", items, reports, subledgers: sub, annualCoverage, financialFingerprint: await ledgerFingerprint(tx, year.startDate, end) };
}
export async function integrityJournalChecks(tx: Prisma.TransactionClient, to: Date) {
  const bad = await tx.$queryRaw<{ id: string; reason: string }[]>`SELECT j.accounting_journal_id AS id,'UNBALANCED_JOURNAL' AS reason FROM arya_accounting_journal j JOIN arya_accounting_journal_line l USING(accounting_journal_id) WHERE j.accounting_date<=${to} GROUP BY j.accounting_journal_id HAVING SUM(l.debit)<>SUM(l.credit)
    UNION ALL SELECT j.accounting_journal_id,'INVALID_PERIOD_LINK_OR_DATE' FROM arya_accounting_journal j LEFT JOIN arya_accounting_period p USING(accounting_period_id) WHERE j.accounting_date<=${to} AND (p.accounting_period_id IS NULL OR j.accounting_date<p.start_date OR j.accounting_date>p.end_date)
    UNION ALL SELECT j.accounting_journal_id,'POSTED_AFTER_CLOSED_WITHOUT_CLOSING_AUTHORITY' FROM arya_accounting_journal j JOIN arya_accounting_period p USING(accounting_period_id) WHERE j.accounting_date<=${to} AND p.status='CLOSED' AND j.posted_at>p.closed_at AND j.source_kind NOT IN ('YEAR_CLOSE','YEAR_REOPEN')
    UNION ALL SELECT j.accounting_journal_id,'FUND_RELEASE_INVALID_ACCOUNTS' FROM arya_accounting_journal j JOIN arya_accounting_journal_line l USING(accounting_journal_id) JOIN arya_accounting_account a USING(accounting_account_id) WHERE j.accounting_date<=${to} AND j.source_kind='FUND_RELEASE' AND a.account_type NOT IN ('REVENUE','NET_ASSET') LIMIT 101`;
  const seals = await verifyPostedLedgerAudits(tx, to);
  return { valid: !bad.length && seals.valid, balanceValid: !bad.some(b => b.reason === "UNBALANCED_JOURNAL"), periodValid: !bad.some(b => b.reason.includes("PERIOD")), releaseValid: !bad.some(b => b.reason === "FUND_RELEASE_INVALID_ACCOUNTS"), seals, exceptions: [...bad.slice(0, 100), ...seals.exceptions], truncated: bad.length > 100, checks: ["BALANCED_JOURNAL", "VALID_PERIOD", "CLOSED_PERIOD_AUTHORITY", "DONOR_RELEASE_NO_CASH_EXPENSE", "APPEND_ONLY_CONTENT_SEALS"] };
}
export const previewClose = (actor: string, type: "PERIOD" | "YEAR", id: string) => readAccounting(actor, tx => closePreview(tx, type, id));
export function prepareClosing(actor: string, type: "PERIOD" | "YEAR", id: string, reopen: boolean, reason: string, evidenceReference: string) { return manageAccounting(actor, async tx => {
  return prepareClosingInTransaction(tx, actor, type, id, reopen, reason, evidenceReference);
}); }
export async function prepareClosingInTransaction(tx: Prisma.TransactionClient, actor: string, type: "PERIOD" | "YEAR", id: string, reopen: boolean, reason: string, evidenceReference: string) {
  const period = type === "PERIOD" ? await periodById(tx, id) : null, year = await yearById(tx, period?.fiscalYearId ?? id), row = period ?? year;
  if (row.status !== (reopen ? "CLOSED" : "OPEN") || period && year.status !== "OPEN") throw new HttpError(409, "Closing/reopening source state is not eligible; reopen fiscal year before a period.");
  if (reopen && type === "YEAR" && await tx.accountingJournal.count({ where: { accountingDate: { gt: year.endDate } } })) throw new HttpError(409, "Review later-year financial activity before reopening this year.");
  const kind = type === "PERIOD" ? reopen ? "PERIOD_REOPEN" : "PERIOD_CLOSE" : reopen ? "YEAR_REOPEN" : "YEAR_CLOSE";
  if (!reopen) { if (period) await tx.accountingPeriod.update({ where: { id }, data: { status: "CLOSING", revision: { increment: 1 } } }); else await tx.accountingFiscalYear.update({ where: { id }, data: { status: "CLOSING", revision: { increment: 1 } } }); }
  const preview = reopen ? { priorStatus: row.status, priorClosingDraftId: row.closingDraftId, yearRevision: String(year.revision), financialFingerprint: await ledgerFingerprint(tx, year.startDate, row.endDate) } : await closePreview(tx, type, id);
  if (!reopen && "status" in preview && preview.status !== "READY") throw new HttpError(409, "Pre-close checklist is not ready; inspect preview exceptions first.");
  const draft = await newFinalDraft(tx, actor, kind, row.endDate, { type, sourceId: id, reason, evidenceReference, previousClosingDraftId: row.closingDraftId, snapshot: preview }, { fiscalYearId: year.id, ...(period ? { accountingPeriodId: id } : {}) });
  const updated = period ? await tx.accountingPeriod.update({ where: { id }, data: { closingDraftId: draft.id } }) : await tx.accountingFiscalYear.update({ where: { id }, data: { closingDraftId: draft.id } }); return { ...draft, sourceRevision: updated.revision };
}
