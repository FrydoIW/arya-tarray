import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { HttpError } from "../../../lib/http.js";
import { accountingCents, accountingTotalCents } from "../accounting.domain.js";
import { aparTransaction, loadDocument } from "../apar/apar.repository.js";
import { exactDocumentTotal } from "../apar/apar.domain.js";
import { ACCOUNTING_MANAGE, requireAccountingPermission } from "../approval/approval.repository.js";
import { invalidateRequests, submitApproval } from "../approval/approval.service.js";
import { draftInclude, loadDraft } from "../approval/approval-source.repository.js";
import { accrualAmounts, accrualLedgerBalance, loadAccrual, lockAccrual } from "./schedule.repository.js";
import { centsToDecimal } from "../../../lib/money.js";
import { day } from "./schedule.domain.js";
import type { AccrualAdjustment, AccrualInput } from "./schedule.schema.js";

export async function requireAccounts(tx: Prisma.TransactionClient, mapping: Array<[string, string]>) {
  const rows = await tx.accountingAccount.findMany({ where: { id: { in: mapping.map(([id]) => id) } } });
  if (new Set(mapping.map(([id]) => id)).size !== mapping.length || mapping.some(([id, type]) => !rows.some(row => row.id === id
    && row.accountType === type && row.activeFlag && row.postingFlag && !row.contraFlag
    && row.normalBalance === (["ASSET", "EXPENSE"].includes(type) ? "DEBIT" : "CREDIT")))) {
    throw new HttpError(409, "Explicit distinct active posting accounts with correct classifications are required.");
  }
}
function accrualLines(input: AccrualInput) {
  const expense = input.metadata.kind === "ACCRUED_EXPENSE";
  return [{ accountId: expense ? input.recognitionAccountId : input.balanceAccountId, debit: input.amount, credit: "0.00" },
    { accountId: expense ? input.balanceAccountId : input.recognitionAccountId, debit: "0.00", credit: input.amount }]
    .map((line, index) => ({ ...line, lineNo: index + 1, counterpartyId: input.counterpartyId }));
}
async function validateInput(tx: Prisma.TransactionClient, input: AccrualInput) {
  if (input.accountingDate < input.metadata.serviceStart) throw new HttpError(400, "Accrual recognition cannot predate its service/earned-right period.");
  await requireAccounts(tx, [[input.recognitionAccountId, input.metadata.kind === "ACCRUED_EXPENSE" ? "EXPENSE" : "REVENUE"],
    [input.balanceAccountId, input.metadata.kind === "ACCRUED_EXPENSE" ? "LIABILITY" : "ASSET"]]);
  if (input.metadata.scheduledReversalOn && input.metadata.scheduledReversalOn < input.accountingDate) throw new HttpError(400, "Scheduled reversal cannot predate recognition.");
  if (input.counterpartyId && !await tx.accountingCounterparty.findFirst({ where: { id: input.counterpartyId, activeFlag: true } })) throw new HttpError(409, "Counterparty is unavailable.");
}
export function createAccrual(actorId: string, input: AccrualInput) {
  return aparTransaction(async tx => {
    await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE); await validateInput(tx, input);
    const id = randomUUID();
    return tx.accountingJournalDraft.create({ data: { id, draftNumber: `ACCRUAL-${id}`, sourceKind: "ACCRUAL_DOCUMENT",
      sourceReference: input.sourceReference, journalType: "ACCRUAL", accountingDate: day(input.accountingDate),
      description: input.metadata.supportingEvidence, accrualMetadata: input.metadata, createdById: actorId,
      lines: { create: accrualLines(input) } }, include: draftInclude });
  });
}
export function updateAccrual(actorId: string, id: string, input: AccrualInput & { expectedRevision: number }) {
  return aparTransaction(async tx => {
    await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE); const original = await loadAccrual(tx, id);
    if (original.createdById !== actorId || original.status !== "DRAFT") throw new HttpError(409, "Only the creator may revise an unposted accrual.");
    await validateInput(tx, input);
    const changed = await tx.accountingJournalDraft.updateMany({ where: { id, revision: input.expectedRevision, status: "DRAFT" }, data: {
      sourceReference: input.sourceReference, accountingDate: day(input.accountingDate), description: input.metadata.supportingEvidence,
      accrualMetadata: input.metadata, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new HttpError(409, "Accrual revision changed.");
    await invalidateRequests(tx, id, actorId); await tx.accountingJournalDraftLine.deleteMany({ where: { journalDraftId: id } });
    await tx.accountingJournalDraftLine.createMany({ data: accrualLines(input).map(line => ({ ...line, journalDraftId: id })) });
    return loadAccrual(tx, id);
  });
}
export async function latestAccrualActivity(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<Array<{ latest: Date | null }>>`
    WITH activity AS (SELECT posted_journal_id AS journal FROM arya_accounting_journal_draft WHERE journal_draft_id=${id} OR parent_accrual_draft_id=${id}
      UNION ALL SELECT recognition_journal_id FROM arya_accounting_document WHERE accrual_draft_id=${id})
    SELECT MAX(GREATEST(j.accounting_date,COALESCE(r.accounting_date,j.accounting_date))) AS latest FROM activity a
      JOIN arya_accounting_journal j ON j.accounting_journal_id=a.journal
      LEFT JOIN arya_accounting_journal r ON r.reversal_of_journal_id=j.accounting_journal_id`;
  return rows[0]?.latest ?? null;
}
export async function validateAccrualClearing(tx: Prisma.TransactionClient, doc: Awaited<ReturnType<typeof loadDocument>>) {
  if (!doc.accrualDraftId) return;
  await lockAccrual(tx, doc.accrualDraftId); const accrual = await loadAccrual(tx, doc.accrualDraftId);
  const amounts = await accrualAmounts(tx, accrual.id), latest = await latestAccrualActivity(tx, accrual.id);
  const expectedKind = accrual.metadata.kind === "ACCRUED_EXPENSE" ? "PAYABLE" : "RECEIVABLE";
  if (!accrual.postedJournal || accrual.postedJournal.revFkAccJournalReversal || doc.documentKind !== expectedKind
    || accrual.balance.counterpartyId && accrual.balance.counterpartyId !== doc.counterpartyId
    || doc.revFkAccDocLineDoc.some(line => line.accountingAccountId !== accrual.balance.accountId)
    || accountingCents(exactDocumentTotal(doc.revFkAccDocLineDoc)) > accountingTotalCents(amounts.remaining)
    || latest && doc.accountingDate < latest || doc.controlAccountId === accrual.balance.accountId) {
    throw new HttpError(409, "AP/AR clearing must use the actual matching accrued balance without duplicate expense/revenue or over-clearing.");
  }
}
const adjustmentMetadata = z.object({ adjustmentKind: z.enum(["INCREASE", "DECREASE"]), reason: z.string().min(10) }).passthrough();
export async function validateAccrualDraft(tx: Prisma.TransactionClient, id: string) {
  const draft = await loadDraft(tx, id);
  if (draft.status !== "DRAFT" || !["ACCRUAL_DOCUMENT", "ACCRUAL_ADJUSTMENT"].includes(draft.sourceKind)) throw new HttpError(409, "Accrual source is not an unposted draft.");
  if (draft.sourceKind === "ACCRUAL_DOCUMENT") {
    const accrual = await loadAccrual(tx, id);
    await requireAccounts(tx, [[accrual.recognition.accountId, accrual.metadata.kind === "ACCRUED_EXPENSE" ? "EXPENSE" : "REVENUE"],
      [accrual.balance.accountId, accrual.metadata.kind === "ACCRUED_EXPENSE" ? "LIABILITY" : "ASSET"]]);
  } else {
    if (!draft.parentAccrualDraftId) throw new HttpError(409, "Adjustment requires its original accrual.");
    await lockAccrual(tx, draft.parentAccrualDraftId); const parent = await loadAccrual(tx, draft.parentAccrualDraftId);
    const metadata = adjustmentMetadata.parse(draft.accrualMetadata), amounts = await accrualAmounts(tx, parent.id);
    const latest = await latestAccrualActivity(tx, parent.id);
    if (!parent.postedJournal || parent.postedJournal.revFkAccJournalReversal || latest && draft.accountingDate < latest
      || metadata.adjustmentKind === "DECREASE" && accountingCents(draft.lines[0]?.debit.plus(draft.lines[0].credit) ?? "0") > accountingTotalCents(amounts.remaining)) {
      throw new HttpError(409, "Accrual adjustment would invalidate the posted balance or chronology.");
    }
  }
  return draft;
}
export function createAccrualAdjustment(actorId: string, id: string, input: AccrualAdjustment) {
  return aparTransaction(async tx => {
    await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE); const original = await loadAccrual(tx, id);
    const reverse = input.adjustmentKind === "DECREASE", draftId = randomUUID();
    const draft = await tx.accountingJournalDraft.create({ data: { id: draftId, draftNumber: `ACC-ADJ-${draftId}`,
      sourceKind: "ACCRUAL_ADJUSTMENT", sourceReference: input.sourceReference, journalType: "ADJUSTMENT", accountingDate: day(input.accountingDate),
      parentAccrualDraftId: id, accrualMetadata: { ...original.metadata, adjustmentKind: input.adjustmentKind, reason: input.reason },
      description: input.reason, createdById: actorId, lines: { create: original.lines.map(line => ({ lineNo: line.lineNo,
        accountId: line.accountId, counterpartyId: line.counterpartyId,
        debit: (accountingCents(line.debit) > 0n) !== reverse ? input.amount : "0.00",
        credit: (accountingCents(line.credit) > 0n) !== reverse ? input.amount : "0.00" })) } }, include: draftInclude });
    await validateAccrualDraft(tx, draft.id); return draft;
  });
}
export function getAccrual(actorId: string, id: string) {
  return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, "ACCOUNTING_REPORT");
    const row = await loadAccrual(tx, id), amounts = await accrualAmounts(tx, id);
    const generalLedger = await accrualLedgerBalance(tx, id, row.balance.accountId, row.metadata.kind === "ACCRUED_EXPENSE");
    const [clearingDocuments, adjustments, history] = await Promise.all([
      tx.accountingDocument.findMany({ where: { accrualDraftId: id }, take: 240, orderBy: { createdAt: "asc" } }),
      tx.accountingJournalDraft.findMany({ where: { parentAccrualDraftId: id }, take: 240, orderBy: { createdAt: "asc" } }),
      tx.accountingApprovalRequest.findMany({ where: { journalDraftId: id }, include: { history: true }, take: 240 })]);
    return { ...row, ...amounts, originalAmount: row.lines[0]?.debit.plus(row.lines[0].credit).toFixed(2),
      controlReconciliation: { generalLedger, subledger: amounts.remaining, reconciled: generalLedger === amounts.remaining,
        variance: centsToDecimal(accountingTotalCents(amounts.remaining) - accountingTotalCents(generalLedger)) },
      reconciliation: !row.postedJournal ? "UNPOSTED" : row.postedJournal.revFkAccJournalReversal ? "REVERSED" : amounts.remaining === "0.00" ? "RESOLVED" : "OUTSTANDING",
      clearingDocuments, adjustments, approvalHistory: history, relatedRecordsLimit: 240 };
  });
}
export async function requestAccrualReversal(actorId: string, id: string, accountingDate?: string, remark = "Scheduled accrual reversal", scheduled = false) {
  const accrual = await aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE); return loadAccrual(tx, id); });
  const selected = scheduled ? accrual.metadata.scheduledReversalOn : accountingDate;
  if (!selected || !accrual.postedJournalId) throw new HttpError(409, "An explicitly marked posted accrual and reversal date are required.");
  return submitApproval(actorId, { kind: "JOURNAL_REVERSAL", sourceDocumentId: accrual.postedJournalId, accountingDate: selected, remark });
}
