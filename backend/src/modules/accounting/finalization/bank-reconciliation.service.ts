import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { bankReconInputSchema, type BankReconInput, type MatchInput } from "./finalization.schema.js";
import { manageAccounting, readAccounting, periodById, currentPolicy, auditFinal, day, cents, money, material, digest } from "./finalization.repository.js";
import { createDraftInTransaction, invalidateRequests } from "../approval/approval.service.js";
const evidenceSchema = bankReconInputSchema.pick({ openingEvidence: true, statementEvidence: true, timingItems: true });
// Recheck each actual match, even when changed source amounts still net to the same statement balance.
// Both callers bind r/p to the reconciliation and period; all values remain parameterized.
const invalidMatchEvidence = Prisma.sql`EXISTS(SELECT 1 FROM arya_accounting_bank_reconciliation_match m
  JOIN arya_bank_transaction b USING(bank_transaction_id) JOIN arya_bank_statement_upload u USING(statement_upload_id)
  JOIN arya_accounting_journal_line l ON l.accounting_journal_line_id=m.accounting_journal_line_id
  JOIN arya_accounting_journal j ON j.accounting_journal_id=l.accounting_journal_id
  WHERE m.bank_reconciliation_id=r.bank_reconciliation_id AND m.match_status='ACTIVE' AND (
    b.source_type<>'BANK' OR b.status<>'FINALIZED' OR b.reconciliation_excluded_at IS NOT NULL OR u.status='WITHDRAWN'
    OR u.bank_account_id<>r.bank_account_id OR (r.statement_upload_id IS NOT NULL AND r.statement_upload_id<>b.statement_upload_id)
    OR b.transaction_date IS NULL OR b.transaction_date<p.start_date OR b.transaction_date>p.end_date
    OR l.bank_account_id IS NULL OR l.bank_account_id<>r.bank_account_id OR l.accounting_account_id<>r.bank_gl_account_id OR j.accounting_date>p.end_date
    OR SIGN(b.original_amount)<>SIGN(l.debit-l.credit) OR b.original_amount=0 OR l.debit=l.credit
    OR j.reversal_of_journal_id IS NOT NULL OR EXISTS(SELECT 1 FROM arya_accounting_journal rev WHERE rev.reversal_of_journal_id=j.accounting_journal_id AND rev.accounting_date<=p.end_date)
    OR ABS(b.original_amount)<(SELECT COALESCE(SUM(x.matched_amount),0) FROM arya_accounting_bank_reconciliation_match x WHERE x.bank_transaction_id=b.bank_transaction_id AND x.match_status='ACTIVE')
    OR ABS(l.debit-l.credit)<(SELECT COALESCE(SUM(x.matched_amount),0) FROM arya_accounting_bank_reconciliation_match x WHERE x.accounting_journal_line_id=l.accounting_journal_line_id AND x.match_status='ACTIVE')
  ))`;
export function listBankReconciliations(actor: string, q: { page: number; pageSize: number }) {
  return readAccounting(actor, async tx => {
    const [total, rows] = await Promise.all([
      tx.accountingBankReconciliation.count(),
      tx.accountingBankReconciliation.findMany({ orderBy: [{ reconciliationDate: "desc" }, { id: "asc" }], take: q.pageSize, skip: (q.page - 1) * q.pageSize })
    ]);
    return { ...q, total, rows };
  });
}
export async function bankReconById(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.accountingBankReconciliation.findUnique({ where: { id } }); if (!row) throw new HttpError(404, "Accounting bank reconciliation not found."); return row;
}
export function createBankReconciliation(actor: string, input: BankReconInput) { return manageAccounting(actor, async tx => {
  const period = await periodById(tx, input.accountingPeriodId), config = await currentPolicy(tx, period.fiscalYearId);
  if (period.status !== "OPEN" || config.year.status !== "OPEN") throw new HttpError(409, "Bank reconciliation creation requires an open accounting period/year.");
  const map = config.policy?.bankAccounts.find(b => b.bankAccountId === input.bankAccountId && b.glAccountId === input.bankGlAccountId);
  if (!map) throw new HttpError(409, "PENDING_POLICY: adopted bank identity/GL mapping required.");
  if (input.statementUploadId && !await tx.bankStatementUpload.count({ where: { id: input.statementUploadId, bankAccountId: input.bankAccountId, status: { not: "WITHDRAWN" } } })) throw new HttpError(409, "Statement upload does not belong to the selected real bank account.");
  return tx.accountingBankReconciliation.create({ data: { bankAccountId: input.bankAccountId, bankGlAccountId: input.bankGlAccountId, accountingPeriodId: period.id, statementUploadId: input.statementUploadId,
    reconciliationReference: input.reconciliationReference, reconciliationDate: period.endDate, statementOpeningBalance: input.statementOpeningBalance, statementClosingBalance: input.statementClosingBalance,
    evidence: { openingEvidence: input.openingEvidence, statementEvidence: input.statementEvidence, timingItems: input.timingItems }, createdById: actor } });
}); }
export async function bankPreview(tx: Prisma.TransactionClient, id: string) {
  const root = await bankReconById(tx, id), period = await periodById(tx, root.accountingPeriodId), evidence = evidenceSchema.parse(root.evidence);
  const [bank, gl, matches, glTotals, invalidMatches] = await Promise.all([
    tx.bankTransaction.findMany({ where: { sourceType: "BANK", statementUpload: { bankAccountId: root.bankAccountId, status: { not: "WITHDRAWN" } }, statementUploadId: root.statementUploadId ?? undefined,
      transactionDate: { gte: period.startDate, lte: period.endDate }, originalAmount: { not: 0 } }, take: 10001, orderBy: { id: "asc" } }),
    tx.accountingJournalLine.findMany({ where: { accountId: root.bankGlAccountId, bankAccountId: root.bankAccountId, journal: { accountingDate: { lte: period.endDate } } },
      include: { journal: { include: { revFkAccJournalReversal: true } } }, take: 10001, orderBy: { id: "asc" } }),
    tx.accountingBankReconciliationMatch.findMany({ where: { matchStatus: "ACTIVE", relFkAccBankMatchBank: { statementUpload: { bankAccountId: root.bankAccountId }, transactionDate: { lte: period.endDate } }, relFkAccBankMatchLine: { accountId: root.bankGlAccountId, bankAccountId: root.bankAccountId, journal: { accountingDate: { lte: period.endDate } } } }, take: 20001, orderBy: { id: "asc" } }),
    tx.$queryRaw<{ opening: Prisma.Decimal; closing: Prisma.Decimal }[]>`SELECT COALESCE(SUM(IF(j.accounting_date<${period.startDate},l.debit-l.credit,0)),0) AS opening,COALESCE(SUM(l.debit-l.credit),0) AS closing FROM arya_accounting_journal_line l JOIN arya_accounting_journal j USING(accounting_journal_id) WHERE l.accounting_account_id=${root.bankGlAccountId} AND l.bank_account_id=${root.bankAccountId} AND j.accounting_date<=${period.endDate}`,
    tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT r.bank_reconciliation_id AS id FROM arya_accounting_bank_reconciliation r JOIN arya_accounting_period p USING(accounting_period_id) WHERE r.bank_reconciliation_id=${id} AND ${invalidMatchEvidence}`)
  ]);
  if (bank.length > 10000 || gl.length > 10000 || matches.length > 20000) throw new HttpError(413, "Narrow bank reconciliation scope; evidence capacity exceeded.");
  const exceptions: { code: string; sourceId?: string; amount?: string }[] = [], bankUsed = new Map<string, bigint>(), glUsed = new Map<string, bigint>();
  if (invalidMatches.length) exceptions.push({ code: "INVALID_MATCH_SOURCE_EVIDENCE", sourceId: id });
  for (const m of matches) { bankUsed.set(m.bankTransactionId, (bankUsed.get(m.bankTransactionId) ?? 0n) + cents(m.matchedAmount)); glUsed.set(m.accountingJournalLineId, (glUsed.get(m.accountingJournalLineId) ?? 0n) + cents(m.matchedAmount)); }
  const unmatchedBank = bank.flatMap(b => { const amount = cents(b.originalAmount), abs = amount < 0n ? -amount : amount, remain = abs - (bankUsed.get(b.id) ?? 0n);
    if (b.status !== "FINALIZED" || b.reconciliationExcludedAt) exceptions.push({ code: "BANK_OPERATIONAL_REVIEW_REQUIRED", sourceId: b.id });
    if (remain < 0n) exceptions.push({ code: "BANK_OVERMATCH", sourceId: b.id }); return remain ? [{ id: b.id, amount: money(remain), direction: amount < 0n ? "OUT" : "IN" }] : []; });
  const activeGL = gl.filter(l => !l.journal.reversalOfJournalId && (!l.journal.revFkAccJournalReversal || l.journal.revFkAccJournalReversal.accountingDate > period.endDate));
  const unmatchedGL = activeGL.flatMap(l => { const amount = cents(l.debit) - cents(l.credit), abs = amount < 0n ? -amount : amount, remaining = abs - (glUsed.get(l.id) ?? 0n); return remaining ? [{ id: l.id, amount: money(remaining), direction: amount < 0n ? "OUT" : "IN", journalId: l.journalId }] : []; });
  const timingIds = new Set<string>(); let timing = 0n;
  for (const item of evidence.timingItems) {
    const l = unmatchedGL.find(l => l.id === item.journalLineId), expected = item.kind === "OUTSTANDING_PAYMENT" ? "OUT" : "IN";
    if (!l || l.direction !== expected || cents(l.amount) !== cents(item.amount) || timingIds.has(item.journalLineId)) exceptions.push({ code: "INVALID_TIMING_EVIDENCE", sourceId: item.journalLineId });
    else { timingIds.add(item.journalLineId); timing += cents(item.amount) * (expected === "OUT" ? -1n : 1n); }
  }
  for (const l of unmatchedGL) if (!timingIds.has(l.id)) exceptions.push({ code: "UNMATCHED_GL_MOVEMENT", sourceId: l.id, amount: l.amount });
  for (const b of unmatchedBank) exceptions.push({ code: "UNMATCHED_BANK_MOVEMENT", sourceId: b.id, amount: b.amount });
  const mutation = bank.reduce((n, b) => n + cents(b.originalAmount), 0n), opening = cents(root.statementOpeningBalance), closing = cents(root.statementClosingBalance), statementDifference = opening + mutation - closing;
  if (statementDifference) exceptions.push({ code: "STATEMENT_ROLLFORWARD_DIFFERENCE", amount: money(statementDifference) });
  const ledgerClosing = cents(glTotals[0]?.closing ?? "0"), difference = closing + timing - ledgerClosing;
  if (difference) exceptions.push({ code: "ADJUSTED_BANK_GL_DIFFERENCE", amount: money(difference) });
  for (const m of matches) { const l = gl.find(l => l.id === m.accountingJournalLineId); if (l && !activeGL.some(a => a.id === l.id)) exceptions.push({ code: "MATCHED_GL_REVERSED", sourceId: l.id }); }
  const result = { id, workflowStatus: root.status, scope: { bankAccountId: root.bankAccountId, bankGlAccountId: root.bankGlAccountId, periodId: period.id, from: period.startDate, to: period.endDate }, revision: root.revision, status: exceptions.length ? "UNVERIFIED" : "VERIFIED",
    statementOpening: money(opening), statementMutations: money(mutation), statementClosing: money(closing), statementDifference: money(statementDifference), glOpening: money(cents(glTotals[0]?.opening ?? "0")), glClosing: money(ledgerClosing), timingAdjustment: money(timing), adjustedBankBalance: money(closing + timing), adjustedGLBalance: money(ledgerClosing), difference: money(difference), unmatchedBank, unmatchedGL, matchedTransactions: matches, exceptions, evidence,
    sourceFingerprint: digest({ root, bank, gl, matches }) };
  return result;
}
export const getBankReconciliation = (actor: string, id: string) => readAccounting(actor, tx => bankPreview(tx, id));
export function matchBank(actor: string, id: string, input: MatchInput) { return manageAccounting(actor, async tx => {
  const root = await bankReconById(tx, id), period = await periodById(tx, root.accountingPeriodId);
  if (root.status !== "OPEN" || period.status !== "OPEN") throw new HttpError(409, "Only an OPEN reconciliation/period can be matched.");
  await tx.$queryRaw`SELECT bank_transaction_id FROM arya_bank_transaction WHERE bank_transaction_id=${input.bankTransactionId} FOR UPDATE`;
  await tx.$queryRaw`SELECT accounting_journal_line_id FROM arya_accounting_journal_line WHERE accounting_journal_line_id=${input.journalLineId} FOR UPDATE`;
  const [b, l] = await Promise.all([tx.bankTransaction.findUnique({ where: { id: input.bankTransactionId }, include: { statementUpload: true } }), tx.accountingJournalLine.findUnique({ where: { id: input.journalLineId }, include: { journal: { include: { revFkAccJournalReversal: true } } } })]);
  if (!b || !l || b.sourceType !== "BANK" || b.status !== "FINALIZED" || b.reconciliationExcludedAt || b.statementUpload.status === "WITHDRAWN" || b.statementUpload.bankAccountId !== root.bankAccountId
    || root.statementUploadId && b.statementUploadId !== root.statementUploadId || !b.transactionDate || b.transactionDate < period.startDate || b.transactionDate > period.endDate || l.bankAccountId !== root.bankAccountId || l.accountId !== root.bankGlAccountId || l.journal.accountingDate > period.endDate || l.journal.reversalOfJournalId || l.journal.revFkAccJournalReversal) throw new HttpError(409, "Match requires actual eligible bank and unreversed GL evidence with exact bank identity/cut-off.");
  const bankAmount = cents(b.originalAmount), glAmount = cents(l.debit) - cents(l.credit), amount = cents(input.amount);
  if (!bankAmount || !glAmount || bankAmount < 0n !== (glAmount < 0n)) throw new HttpError(409, "Bank and GL directions differ.");
  const [bankSum, glSum, prior] = await Promise.all([tx.accountingBankReconciliationMatch.aggregate({ where: { bankTransactionId: b.id, matchStatus: "ACTIVE" }, _sum: { matchedAmount: true } }), tx.accountingBankReconciliationMatch.aggregate({ where: { accountingJournalLineId: l.id, matchStatus: "ACTIVE" }, _sum: { matchedAmount: true } }), tx.accountingBankReconciliationMatch.findUnique({ where: { bankTransactionId_accountingJournalLineId: { bankTransactionId: b.id, accountingJournalLineId: l.id } } })]);
  if (cents(bankSum._sum.matchedAmount ?? "0") + amount > (bankAmount < 0n ? -bankAmount : bankAmount) || cents(glSum._sum.matchedAmount ?? "0") + amount > (glAmount < 0n ? -glAmount : glAmount) || prior?.matchStatus === "ACTIVE") throw new HttpError(409, "Duplicate match or amount exceeds remaining bank/GL capacity.");
  const row = prior ? await tx.accountingBankReconciliationMatch.update({ where: { id: prior.id }, data: { bankReconciliationId: root.id, matchedAmount: input.amount, matchStatus: "ACTIVE", matchedById: actor, matchedAt: new Date(), voidedAt: null, voidedById: null } })
    : await tx.accountingBankReconciliationMatch.create({ data: { bankReconciliationId: root.id, bankTransactionId: b.id, accountingJournalLineId: l.id, matchedAmount: input.amount, matchedById: actor } });
  await tx.accountingBankReconciliation.update({ where: { id }, data: { revision: { increment: 1 } } }); await invalidateRequests(tx, id, actor);
  await auditFinal(tx, actor, "BANK_MATCH", { match: row, evidence: input.evidence }, { bankReconciliationId: id, accountingPeriodId: period.id }); return row;
}); }
export function voidBankMatch(actor: string, id: string, matchId: string, reason: string) { return manageAccounting(actor, async tx => {
  const root = await bankReconById(tx, id), period = await periodById(tx, root.accountingPeriodId), row = await tx.accountingBankReconciliationMatch.findUnique({ where: { id: matchId } });
  if (root.status !== "OPEN" || period.status !== "OPEN" || !row || row.bankReconciliationId !== id || row.matchStatus !== "ACTIVE") throw new HttpError(409, "Only active matches in an OPEN reconciliation/period may be voided.");
  await tx.accountingBankReconciliationMatch.update({ where: { id: matchId }, data: { matchStatus: "VOID", voidedAt: new Date(), voidedById: actor } }); await tx.accountingBankReconciliation.update({ where: { id }, data: { revision: { increment: 1 } } }); await invalidateRequests(tx, id, actor);
  await auditFinal(tx, actor, "BANK_MATCH_VOID", { prior: row, reason }, { bankReconciliationId: id, accountingPeriodId: period.id }); return { matchId, status: "VOID" };
}); }
export function bankAdjustmentDraft(actor: string, id: string, input: { bankTransactionId: string; kind: "CHARGE" | "INTEREST"; offsetAccountId: string; evidence: string }) { return manageAccounting(actor, async tx => {
  const root = await bankReconById(tx, id), period = await periodById(tx, root.accountingPeriodId);
  if (root.status !== "OPEN" || period.status !== "OPEN") throw new HttpError(409, "Bank adjustment draft requires OPEN reconciliation/period.");
  await tx.$queryRaw`SELECT bank_transaction_id FROM arya_bank_transaction WHERE bank_transaction_id=${input.bankTransactionId} FOR UPDATE`;
  const bank = await tx.bankTransaction.findUnique({ where: { id: input.bankTransactionId }, include: { statementUpload: true } }), account = await tx.accountingAccount.findUnique({ where: { id: input.offsetAccountId } });
  if (!bank || bank.sourceType !== "BANK" || bank.status !== "FINALIZED" || bank.reconciliationExcludedAt || bank.statementUpload.bankAccountId !== root.bankAccountId || !bank.transactionDate || bank.transactionDate < period.startDate || bank.transactionDate > period.endDate
    || !account?.activeFlag || !account.postingFlag || account.accountType !== (input.kind === "CHARGE" ? "EXPENSE" : "REVENUE")) throw new HttpError(409, "Adjustment requires actual finalized charge/interest evidence and explicit correctly classified offset account.");
  const amount = cents(bank.originalAmount); if (input.kind === "CHARGE" ? amount >= 0n : amount <= 0n) throw new HttpError(409, "Charge/interest direction does not match bank evidence.");
  const recognized = await tx.accountingJournal.count({ where: { bankTransactionId: bank.id, revFkAccJournalReversal: { is: null }, journalType: { not: "REVERSAL" } } });
  const matches = await tx.accountingBankReconciliationMatch.count({ where: { bankTransactionId: bank.id, matchStatus: "ACTIVE" } });
  const drafts = await tx.accountingJournalDraft.count({ where: { sourceKind: "ADJUSTING_JOURNAL", OR: [{ status: "DRAFT" }, { status: "POSTED", postedJournal: { revFkAccJournalReversal: { is: null } } }], finalizationMetadata: { path: "$.bankTransactionId", equals: bank.id } } });
  if (recognized || matches || drafts) throw new HttpError(409, "Bank evidence already has recognition, matching or an adjustment draft; review rather than duplicate cash.");
  const value = money(amount < 0n ? -amount : amount), incoming = input.kind === "INTEREST";
  const d = await createDraftInTransaction(tx, actor, { journalType: "ADJUSTMENT", accountingDate: bank.transactionDate.toISOString().slice(0, 10), sourceReference: `BANKADJ-${bank.id}-${randomUUID()}`, description: input.evidence,
    lines: [{ accountId: root.bankGlAccountId, debit: incoming ? value : "0.00", credit: incoming ? "0.00" : value, bankAccountId: root.bankAccountId }, { accountId: account.id, debit: incoming ? "0.00" : value, credit: incoming ? value : "0.00" }] });
  return tx.accountingJournalDraft.update({ where: { id: d.id }, data: { bankReconciliationId: id, finalizationMetadata: input }, include: { lines: true } });
}); }
export async function validateBankAdjustment(tx: Prisma.TransactionClient, draft: { id: string; finalizationMetadata: unknown; bankReconciliationId: string | null; accountingDate: Date; lines: { accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal; bankAccountId: string | null }[] }) {
  if (!draft.bankReconciliationId) return;
  const p = z.object({ bankTransactionId: z.string().uuid(), kind: z.enum(["CHARGE", "INTEREST"]), offsetAccountId: z.string().uuid(), evidence: z.string().min(10) }).strict().parse(draft.finalizationMetadata), root = await bankReconById(tx, draft.bankReconciliationId);
  const bank = await tx.bankTransaction.findUnique({ where: { id: p.bankTransactionId }, include: { statementUpload: true } });
  if (!bank || bank.status !== "FINALIZED" || bank.reconciliationExcludedAt || bank.statementUpload.bankAccountId !== root.bankAccountId || !bank.transactionDate || bank.transactionDate.getTime() !== draft.accountingDate.getTime()) throw new HttpError(409, "Bank adjustment evidence changed after preparation.");
  const value = cents(bank.originalAmount), incoming = p.kind === "INTEREST", cash = draft.lines.find(l => l.accountId === root.bankGlAccountId), offset = draft.lines.find(l => l.accountId === p.offsetAccountId);
  if (draft.lines.length !== 2 || !cash || !offset || cash.bankAccountId !== root.bankAccountId || value !== cents(cash.debit) - cents(cash.credit) || -value !== cents(offset.debit) - cents(offset.credit) || incoming !== (value > 0n)) throw new HttpError(409, "Bank adjustment lines no longer match actual charge/interest evidence.");
  if (await tx.accountingSettlement.count({ where: { bankTransactionId: bank.id, status: { in: ["DRAFT", "POSTED"] } } })) throw new HttpError(409, "Bank adjustment source is reserved by AP/AR.");
}
export async function validateMatchedBankReversal(tx: Prisma.TransactionClient, journalId: string) {
  if (await tx.accountingBankReconciliationMatch.count({ where: { matchStatus: "ACTIVE", relFkAccBankMatchLine: { journalId } } })) throw new HttpError(409, "Void live bank matches through an OPEN, independently reopened reconciliation before reversing their GL evidence.");
}
export async function bankReviewControl(tx: Prisma.TransactionClient, fiscalYearId: string, from: Date, to: Date) {
  const { policy } = await currentPolicy(tx, fiscalYearId);
  const [periods, roots, observed] = await Promise.all([tx.accountingPeriod.findMany({ where: { fiscalYearId, startDate: { lte: to }, endDate: { gte: from } } }), tx.accountingBankReconciliation.findMany({ where: { status: "CLOSED", relFkAccBankReconPeriod: { fiscalYearId, startDate: { lte: to }, endDate: { gte: from } } } }),
    tx.accountingJournalLine.findMany({ where: { bankAccountId: { not: null }, journal: { accountingDate: { lte: to } }, account: { accountType: "ASSET", normalBalance: "DEBIT", contraFlag: false } }, distinct: ["bankAccountId", "accountId"], select: { bankAccountId: true, accountId: true }, take: 101 })]);
  const missing = !policy ? ["PENDING_POLICY"] : policy.bankAccounts.flatMap(b => periods.filter(p => !roots.some(r => r.bankAccountId === b.bankAccountId && r.bankGlAccountId === b.glAccountId && r.accountingPeriodId === p.id)).map(p => `${b.bankAccountId}:${p.id}`));
  for (const o of observed) if (!policy?.bankAccounts.some(b => b.bankAccountId === o.bankAccountId && b.glAccountId === o.accountId)) missing.push(`UNMAPPED_BANK_GL:${o.bankAccountId}:${o.accountId}`);
  const stale = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT DISTINCT r.bank_reconciliation_id AS id FROM arya_accounting_bank_reconciliation r JOIN arya_accounting_period p USING(accounting_period_id) WHERE p.fiscal_year_id=${fiscalYearId} AND p.start_date<=${to} AND p.end_date>=${from} AND r.status='CLOSED' AND (
    EXISTS(SELECT 1 FROM arya_accounting_journal_line l JOIN arya_accounting_journal j USING(accounting_journal_id) WHERE l.bank_account_id=r.bank_account_id AND l.accounting_account_id=r.bank_gl_account_id AND j.accounting_date<=p.end_date AND j.posted_at>r.closed_at)
    OR r.statement_opening_balance+COALESCE((SELECT SUM(b.original_amount) FROM arya_bank_transaction b JOIN arya_bank_statement_upload s USING(statement_upload_id) WHERE s.bank_account_id=r.bank_account_id AND s.status<>'WITHDRAWN' AND b.source_type='BANK' AND b.transaction_date>=p.start_date AND b.transaction_date<=p.end_date AND (r.statement_upload_id IS NULL OR r.statement_upload_id=b.statement_upload_id)),0)<>r.statement_closing_balance
    OR EXISTS(SELECT 1 FROM arya_accounting_bank_reconciliation_match m JOIN arya_bank_transaction b USING(bank_transaction_id) WHERE m.bank_reconciliation_id=r.bank_reconciliation_id AND m.match_status='ACTIVE' AND (b.reconciliation_excluded_at IS NOT NULL OR b.status<>'FINALIZED'))
    OR EXISTS(SELECT 1 FROM arya_bank_transaction b JOIN arya_bank_statement_upload u USING(statement_upload_id) WHERE u.bank_account_id=r.bank_account_id AND u.status<>'WITHDRAWN' AND b.source_type='BANK' AND b.transaction_date>=p.start_date AND b.transaction_date<=p.end_date AND (r.statement_upload_id IS NULL OR r.statement_upload_id=b.statement_upload_id) AND (ABS(b.original_amount)<>COALESCE((SELECT SUM(m.matched_amount) FROM arya_accounting_bank_reconciliation_match m WHERE m.bank_transaction_id=b.bank_transaction_id AND m.match_status='ACTIVE'),0) OR b.reconciliation_excluded_at IS NOT NULL OR b.status<>'FINALIZED'))
    OR ${invalidMatchEvidence}) LIMIT 101`);
  return { control: "BANK_RECONCILIATION_REVIEW", status: missing.length || stale.length || observed.length > 100 ? "UNVERIFIED" : !observed.length && !policy?.bankAccounts.length ? "NOT_APPLICABLE" : "VERIFIED", missing, stale, sourceReferences: roots.map(r => r.id) };
}
