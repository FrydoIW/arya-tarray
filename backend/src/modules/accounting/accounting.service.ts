import { accountingCutoverDate, accountingDateValue, accountingState, recognitionLines, reclassificationLines, accountingCents, accountingTotalCents } from "./accounting.domain.js";
import { mapAccountingDimension, mapAccountingSource } from "./accounting.posting.js";
import { loadAccountingJournal, loadAccountingReport, loadAccountingOptions } from "./accounting.repository.js";
import type { AccountingQuery } from "./accounting.schema.js";
import { centsToDecimal } from "../../lib/money.js";
import { HttpError } from "../../lib/http.js";

export type AccountingReportRow = Record<string, string | number | null>;
export const getAccountingOptions = loadAccountingOptions;
const decimal = (v: { toFixed(n: number): string } | null) => v?.toFixed(2) ?? "0.00";
export async function getAccountingReport(q: AccountingQuery, exportAll = false) {
  const cutover = accountingCutoverDate();
  const data = await loadAccountingReport(q, exportAll);
  if ((exportAll && data.total > 10000) || (data.kind === "monthly" && data.rows.length > 10000)) {
    throw new HttpError(413, "Report exceeds 10,000 rows. Narrow the date or dimension filters.");
  }
  let rows: AccountingReportRow[];
  if (data.kind === "journals") rows = data.rows.map(j => ({ id: j.id, date: accountingDateValue(j.accountingDate),
    journal: j.journalNumber, type: j.journalType, source: j.bankTransactionId, relatedJournal: j.relatedJournalId,
    debit: centsToDecimal(j.lines.reduce((s, l) => s + accountingCents(l.debit), 0n)),
    credit: centsToDecimal(j.lines.reduce((s, l) => s + accountingCents(l.credit), 0n)),
    event: j.lines.find(l => l.credit.greaterThan(0))?.eventNameSnapshot ?? null }));
  else if (data.kind === "ledger") rows = data.rows.map(l => ({ id: l.id, journalId: l.journalId,
    date: accountingDateValue(l.journal.accountingDate), journal: l.journal.journalNumber,
    account: `${l.accountCodeSnapshot} ${l.accountNameSnapshot}`, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2),
    bank: l.bankAccountNameSnapshot, event: l.eventNameSnapshot, eventType: l.eventTypeSnapshot,
    campaign: l.campaignNameSnapshot, member: l.memberNameSnapshot, donor: l.donorNameSnapshot }));
  else if (data.kind === "trial") rows = data.rows.map(l => ({ account: `${l.accountCodeSnapshot} ${l.accountNameSnapshot}`,
    debit: decimal(l._sum.debit), credit: decimal(l._sum.credit),
    movementBalance: centsToDecimal(accountingTotalCents(decimal(l._sum.debit)) - accountingTotalCents(decimal(l._sum.credit))) }));
  else if (data.kind === "monthly") rows = data.rows.map(l => ({ month: l.month, bank: l.bank, eventType: l.eventType,
    event: l.event, campaign: l.campaign, debit: decimal(l.debit), credit: decimal(l.credit),
    revenue: centsToDecimal(accountingTotalCents(decimal(l.credit)) - accountingTotalCents(decimal(l.debit))), entries: Number(l.journals) }));
  else rows = data.rows.map(row => {
    const source = mapAccountingSource(row);
    const recognition = row.accountingJournals.find(j => j.journalType === "RECOGNITION");
    let state = accountingState(source, !!recognition, cutover);
    let lines = [] as ReturnType<typeof recognitionLines>;
    const item = row.correctionItems[0];
    if (q.view === "pending") {
      if (item?.action === "EXCLUDED" || source.sourceType === "MANUAL") state = "ACCOUNTING_REVIEW_REQUIRED";
      else if (item?.action === "MODIFIED" && recognition && source.transactionDate && source.transactionDate >= cutover) {
        const prior = row.accountingJournals.at(-1)?.lines.find(l => l.accountCodeSnapshot === "4110" && l.credit.greaterThan(0));
        const original = recognition.lines.find(l => l.accountCodeSnapshot === "4110" && l.credit.greaterThan(0));
        if (prior && original) lines = reclassificationLines(original.credit.toFixed(2), prior, { ...mapAccountingDimension(row),
          eventCodeId: item.proposedEventCodeId, eventCodeSnapshot: item.proposedEventCode?.code ?? null,
          eventNameSnapshot: item.proposedEventCode?.eventName ?? null, eventTypeSnapshot: item.proposedEventCode?.eventType ?? null,
          eventCampaignId: item.proposedEventCampaignId, campaignNameSnapshot: item.proposedEventCampaign?.campaignName ?? null });
      } else if (!recognition && source.status === "CHECK" && !item) {
        lines = recognitionLines({ ...source, status: "FINALIZED" }, mapAccountingDimension(row), cutover);
        if (!lines.length && (!source.transactionDate || source.transactionDate >= cutover)) {
          state = accountingCents(source.originalAmount) > 0n ? "ACCOUNTING_REVIEW_REQUIRED" : "NOT_APPLICABLE";
        }
      }
      if (lines.length) state = "PREVIEW_NOT_POSTED";
    }
    return { id: row.id, date: row.transactionDate ? accountingDateValue(row.transactionDate) : null,
      source: row.sourceType, amount: row.originalAmount.toFixed(2), bank: row.statementUpload.bankAccount.accountName,
      event: item && q.view === "pending" ? item.proposedEventCode?.eventName ?? null : row.eventCode?.eventName ?? null,
      eventType: item && q.view === "pending" ? item.proposedEventCode?.eventType ?? null : row.eventCode?.eventType ?? null,
      campaign: item && q.view === "pending" ? item.proposedEventCampaign?.campaignName ?? null : row.eventCampaign?.campaignName ?? null,
      donor: row.memberIdentity?.accountName ?? row.senderName, member: row.memberIdentity?.verificationStatus === "VERIFIED" ? row.memberIdentity.member?.memberName ?? null : null,
      approvalState: row.statementUpload.status, state, journalId: recognition?.id ?? null,
      previewDebitAccount: lines[0]?.accountCode ?? null, previewCreditAccount: lines[1]?.accountCode ?? null,
      previewDebit: lines[0]?.debit ?? null, previewCredit: lines[1]?.credit ?? null, statementId: row.statementUploadId };
  });
  const additions = data.kind === "source" ? data.additions.map(a => ({ id: a.id,
    date: a.manualTransactionDate ? accountingDateValue(a.manualTransactionDate) : null,
    description: a.manualDescription, amount: decimal(a.manualOriginalAmount), state: "ACCOUNTING_REVIEW_REQUIRED", proposalId: a.proposalId })) : [];
  const totalDebit = decimal(data.totals._sum.debit);
  const totalCredit = decimal(data.totals._sum.credit);
  return { view: q.view, cutoverDate: accountingDateValue(cutover), coverage: "Phase 1 journals only; no backfill or opening balance",
    preview: q.view === "pending", rows, additions, additionsLimit: 100, total: data.total,
    page: data.page, pageSize: q.pageSize, totalDebit, totalCredit,
    movementBalance: centsToDecimal(accountingTotalCents(totalDebit) - accountingTotalCents(totalCredit)),
    balanced: totalDebit === totalCredit, trialScope: "All lines of matching journals; period movement only", filters: q };
}

export async function getAccountingJournal(id: string) {
  const journal = await loadAccountingJournal(id);
  if (!journal) throw new HttpError(404, "Accounting journal not found");
  return { ...journal, accountingDate: accountingDateValue(journal.accountingDate),
    state: journal.bankTransaction.reconciliationExcludedAt ? "ACCOUNTING_REVIEW_REQUIRED" : "POSTED",
    lines: journal.lines.map(line => ({ ...line, debit: line.debit.toFixed(2), credit: line.credit.toFixed(2) })) };
}
