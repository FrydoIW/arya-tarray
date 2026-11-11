import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { accountingCents, accountingTotalCents } from "../accounting.domain.js";
import type { LedgerJournalInput } from "../ledger/ledger.service.js";
import { documentKindSchema, type AdjustmentInput } from "./apar.schema.js";
import { exactDocumentTotal, assertNoOverpayment, positiveCents, validateAllocations } from "./apar.domain.js";
import { activeSettlementsForBank, latestDocumentActivity, liveOutstanding, loadDocument, loadSettlement, lockBankTransaction, requireChronologicalDocumentActivity } from "./apar.repository.js";
import { parseAdjustmentPayload } from "./apar-source.repository.js";
import { validateAccrualClearing } from "../schedules/accrual.service.js";

export type AparPostingPlan = { expected: LedgerJournalInput; documentId?: string; settlementId?: string;
  revision?: number; adjustment?: { documentId: string; input: AdjustmentInput } };
async function postingAccount(tx: Prisma.TransactionClient, id: string, type: string) {
  const account = await tx.accountingAccount.findUnique({ where: { id } });
  if (!account || account.accountType !== type || !account.activeFlag || !account.postingFlag
    || account.contraFlag || account.normalBalance !== (type === "LIABILITY" ? "CREDIT" : "DEBIT")) {
    throw new HttpError(409, `An active ${type} posting control account with its normal balance is required.`);
  }
  return account;
}
export async function validateDocumentSource(tx: Prisma.TransactionClient, document: Awaited<ReturnType<typeof loadDocument>>) {
  const kind = documentKindSchema.parse(document.documentKind);
  if (!document.relFkAccDocCounterparty.activeFlag || ![kind === "PAYABLE" ? "VENDOR" : "DEBTOR", "BOTH"].includes(document.relFkAccDocCounterparty.counterpartyType)) {
    throw new HttpError(409, "Counterparty is inactive or incompatible with this AP/AR document.");
  }
  if (document.dueDate < document.documentDate || document.recognitionBasis.trim().length < 10) {
    throw new HttpError(400, "Document requires a valid due date and explicit recognition evidence/basis.");
  }
  await postingAccount(tx, document.controlAccountId, kind === "PAYABLE" ? "LIABILITY" : "ASSET");
  if (document.accrualDraftId) { await validateAccrualClearing(tx, document); return exactDocumentTotal(document.revFkAccDocLineDoc); }
  const ids = [...new Set(document.revFkAccDocLineDoc.map(line => line.accountingAccountId))];
  const offsets = await tx.accountingAccount.findMany({ where: { id: { in: ids } } });
  const allowed = kind === "PAYABLE" ? ["EXPENSE", "ASSET"] : ["REVENUE", "LIABILITY"];
  if (offsets.length !== ids.length || offsets.some(account => !account.activeFlag || !account.postingFlag || account.contraFlag
    || !allowed.includes(account.accountType) || account.id === document.controlAccountId
    || account.normalBalance !== (kind === "PAYABLE" ? "DEBIT" : "CREDIT"))) {
    throw new HttpError(409, "Document offsets must use explicit active expense/asset (AP) or revenue/liability (AR) accounts.");
  }
  return exactDocumentTotal(document.revFkAccDocLineDoc);
}
export async function validateBankMatch(tx: Prisma.TransactionClient,
  settlement: Pick<Awaited<ReturnType<typeof loadSettlement>>, "id" | "settlementKind" | "bankAccountId" | "amount">,
  bankTransactionId: string) {
  const bank = await lockBankTransaction(tx, bankTransactionId);
  if (await tx.accountingJournalDraft.count({ where: { fundActiveBankId: bankTransactionId } })) throw new HttpError(409, "Bank transaction is reserved by an explicit conditional fund policy decision.");
  if (await tx.accountingJournalDraft.count({ where: { sourceKind: "ADJUSTING_JOURNAL", finalizationMetadata: { path: "$.bankTransactionId", equals: bankTransactionId }, OR: [{ status: "DRAFT" }, { status: "POSTED", postedJournal: { revFkAccJournalReversal: { is: null } } }] } })) throw new HttpError(409, "Bank transaction is reserved by an approved-source bank charge/interest adjustment workflow.");
  const expected = accountingCents(settlement.amount) * (settlement.settlementKind === "PAYABLE" ? -1n : 1n);
  if (bank.sourceType !== "BANK" || !bank.transactionDate || bank.reconciliationExcludedAt
    || bank.statementUpload.status === "WITHDRAWN" || bank.statementUpload.bankAccountId !== settlement.bankAccountId
    || bank.statementUpload.bankAccount.currencyCode !== "IDR" || accountingCents(bank.originalAmount) !== expected) {
    throw new HttpError(409, "Bank match requires an actual non-excluded IDR transaction with the exact account, direction and amount.");
  }
  if ((await activeSettlementsForBank(tx, bankTransactionId, settlement.id)).length) {
    throw new HttpError(409, "Bank transaction is already linked to another posted settlement.");
  }
  if (bank.accountingJournals.some(journal => (journal.sourceKind === "FINALIZED_BANK_TRANSACTION"
    || journal.journalType === "RECOGNITION" && journal.sourceKind === null) && !journal.revFkAccJournalReversal)) {
    throw new HttpError(409, "Bank income already has active Phase 1 recognition; obtain its approved reversal before AP/AR matching or posting.");
  }
  return bank;
}
export async function prepareAparPosting(tx: Prisma.TransactionClient, request: {
  id?: string; requestKind: string; sourceDocumentId: string; requestPayload?: unknown;
}, postedById: string): Promise<AparPostingPlan> {
  if (request.requestKind === "AP_INVOICE" || request.requestKind === "AR_DOCUMENT") {
    const document = await loadDocument(tx, request.sourceDocumentId,
      request.requestKind === "AP_INVOICE" ? "PAYABLE" : "RECEIVABLE");
    if (document.status !== "DRAFT" || document.recognitionJournalId) throw new HttpError(409, "Document is no longer an unposted draft.");
    const total = await validateDocumentSource(tx, document);
    const payable = document.documentKind === "PAYABLE";
    return { documentId: document.id, revision: document.revision, expected: {
      approvalRequestId: request.id, journalType: "RECOGNITION", sourceKind: payable ? "AP_DOCUMENT" : "AR_DOCUMENT",
      sourceReference: document.id, accountingDate: document.accountingDate, postedById,
      descriptionSnapshot: `${payable ? "AP" : "AR"} ${document.documentNumber}`,
      lines: [...document.revFkAccDocLineDoc.map(line => ({ accountId: line.accountingAccountId,
        debit: payable ? line.amount.toFixed(2) : "0.00", credit: payable ? "0.00" : line.amount.toFixed(2),
        counterpartyId: document.counterpartyId, accountingFundId: line.accountingFundId, eventCampaignId: line.eventCampaignId })),
      { accountId: document.controlAccountId, debit: payable ? "0.00" : total, credit: payable ? total : "0.00",
        counterpartyId: document.counterpartyId }] } };
  }
  if (request.requestKind === "SETTLEMENT") {
    const settlement = await loadSettlement(tx, request.sourceDocumentId);
    const kind = documentKindSchema.parse(settlement.settlementKind);
    if (settlement.status !== "DRAFT" || settlement.postingJournalId) throw new HttpError(409, "Settlement is no longer an unposted draft.");
    if (!settlement.relFkAccSettlementCp.activeFlag || ![kind === "PAYABLE" ? "VENDOR" : "DEBTOR", "BOTH"].includes(settlement.relFkAccSettlementCp.counterpartyType)) throw new HttpError(409, "Counterparty is inactive or incompatible.");
    if (!settlement.bankAccount.activeFlag || settlement.bankAccount.currencyCode !== "IDR") throw new HttpError(409, "An active IDR bank account is required.");
    await postingAccount(tx, settlement.bankGlAccountId, "ASSET");
    const allocations = settlement.revFkAccAllocationSettlement.map(row => ({ accountingDocumentId: row.accountingDocumentId, allocatedAmount: row.allocatedAmount.toFixed(2) }));
    validateAllocations(settlement.amount.toFixed(2), allocations);
    const ids = allocations.map(row => row.accountingDocumentId);
    await requireChronologicalDocumentActivity(tx, ids, settlement.settlementDate);
    const documents = await tx.accountingDocument.findMany({ where: { id: { in: ids } } });
    const balances = new Map((await liveOutstanding(tx, kind, ids)).map(row => [row.id, row]));
    const byId = new Map(documents.map(document => [document.id, document]));
    const payable = kind === "PAYABLE";
    const lines = allocations.map(allocation => {
      const document = byId.get(allocation.accountingDocumentId), balance = balances.get(allocation.accountingDocumentId);
      if (!document || !balance || document.documentKind !== kind || document.counterpartyId !== settlement.counterpartyId
        || document.status !== "RECOGNIZED" || document.accountingDate > settlement.settlementDate
        || document.controlAccountId === settlement.bankGlAccountId) throw new HttpError(409, "Allocations require posted unreversed documents of the same counterparty/kind, dated no later than settlement.");
      assertNoOverpayment(allocation.allocatedAmount, balance.outstanding.toFixed(2));
      return { accountId: document.controlAccountId, debit: payable ? allocation.allocatedAmount : "0.00",
        credit: payable ? "0.00" : allocation.allocatedAmount, counterpartyId: settlement.counterpartyId };
    });
    if (settlement.bankTransactionId) await validateBankMatch(tx, settlement, settlement.bankTransactionId);
    return { settlementId: settlement.id, revision: settlement.revision, expected: {
      approvalRequestId: request.id, journalType: payable ? "PAYMENT" : "RECEIPT",
      sourceKind: payable ? "AP_SETTLEMENT" : "AR_SETTLEMENT", sourceReference: settlement.id,
      accountingDate: settlement.settlementDate, postedById, descriptionSnapshot: settlement.sourceReference,
      bankTransactionId: settlement.bankTransactionId, lines: [...lines, { accountId: settlement.bankGlAccountId,
        debit: payable ? "0.00" : settlement.amount.toFixed(2), credit: payable ? settlement.amount.toFixed(2) : "0.00",
        bankAccountId: settlement.bankAccountId, counterpartyId: settlement.counterpartyId }] } };
  }
  if (request.requestKind === "AR_ADJUSTMENT") {
    const document = await loadDocument(tx, request.sourceDocumentId, "RECEIVABLE");
    const input = parseAdjustmentPayload(request.requestPayload);
    await requireChronologicalDocumentActivity(tx, [document.id], new Date(input.accountingDate));
    const balance = (await liveOutstanding(tx, "RECEIVABLE", [document.id]))[0];
    if (document.status !== "RECOGNIZED" || !balance) throw new HttpError(409, "AR adjustment requires a posted unreversed receivable.");
    if (new Date(input.accountingDate) < document.accountingDate) throw new HttpError(409, "Adjustment cannot predate receivable recognition.");
    const increase = input.adjustmentKind === "INCREASE";
    if (!increase) assertNoOverpayment(input.amount, balance.outstanding.toFixed(2));
    const offset = await tx.accountingAccount.findUnique({ where: { id: input.offsetAccountId } });
    if (!offset || !offset.activeFlag || !offset.postingFlag || offset.contraFlag || offset.id === document.controlAccountId
      || offset.normalBalance !== (offset.accountType === "EXPENSE" ? "DEBIT" : "CREDIT")
      || !(increase ? ["REVENUE", "LIABILITY"] : ["REVENUE", "LIABILITY", "EXPENSE"]).includes(offset.accountType)) {
      throw new HttpError(409, "Adjustment requires an explicit valid revenue/liability offset or expense write-off account.");
    }
    positiveCents(input.amount);
    return { adjustment: { documentId: document.id, input }, expected: { approvalRequestId: request.id,
      journalType: "ADJUSTMENT", sourceKind: "AR_ADJUSTMENT", sourceReference: input.adjustmentReference,
      accountingDate: new Date(`${input.accountingDate}T00:00:00.000Z`), postedById, descriptionSnapshot: input.reason,
      relatedJournalId: document.recognitionJournalId,
      lines: [{ accountId: document.controlAccountId, debit: increase ? input.amount : "0.00", credit: increase ? "0.00" : input.amount,
        counterpartyId: document.counterpartyId }, { accountId: input.offsetAccountId,
        debit: increase ? "0.00" : input.amount, credit: increase ? input.amount : "0.00", counterpartyId: document.counterpartyId }] } };
  }
  throw new HttpError(409, "Unsupported AP/AR approval source.");
}

export function bankMatchHistory(tx: Prisma.TransactionClient, settlementId: string, bankId: string, actorId: string, remark: string, released = false) {
  return tx.bankTransactionHistory.create({ data: { bankTransactionId: bankId, fieldName: "accounting_settlement_active",
    oldValue: released ? settlementId : null, newValue: released ? null : settlementId,
    remark, changedAt: new Date(), changedById: actorId } });
}
export async function applyAparPosting(tx: Prisma.TransactionClient, plan: AparPostingPlan, journalId: string, actorId: string, requesterId: string) {
  if (plan.documentId) {
    const result = await tx.accountingDocument.updateMany({ where: { id: plan.documentId, status: "DRAFT", revision: plan.revision },
      data: { status: "RECOGNIZED", recognitionJournalId: journalId } });
    if (result.count !== 1) throw new HttpError(409, "Document changed before posting.");
  } else if (plan.settlementId) {
    const result = await tx.accountingSettlement.updateMany({ where: { id: plan.settlementId, status: "DRAFT", revision: plan.revision },
      data: { status: "POSTED", postingJournalId: journalId } });
    if (result.count !== 1) throw new HttpError(409, "Settlement changed before posting.");
    if (plan.expected.bankTransactionId) await bankMatchHistory(tx, plan.settlementId, plan.expected.bankTransactionId, actorId, "Matched by approved AP/AR settlement posting.");
  } else if (plan.adjustment) {
    const { input, documentId } = plan.adjustment;
    await tx.accountingDocumentAdjustment.create({ data: { accountingDocumentId: documentId,
      adjustmentReference: input.adjustmentReference, adjustmentKind: input.adjustmentKind,
      amount: input.amount, reason: input.reason, adjustmentJournalId: journalId, createdById: requesterId } });
  }
}

export async function aparReversalContext(tx: Prisma.TransactionClient, journalId: string) {
  const document = await tx.accountingDocument.findUnique({ where: { recognitionJournalId: journalId } });
  if (document) {
    const balances = await liveOutstanding(tx, documentKindSchema.parse(document.documentKind), [document.id]);
    const activeAdjustments = await tx.accountingDocumentAdjustment.count({ where: { accountingDocumentId: document.id,
      relFkAccDocAdjustJournal: { is: { revFkAccJournalReversal: { is: null } } } } });
    const schedules = await tx.accountingSchedule.count({ where: { accountingDocumentId: document.id, status: "ACTIVE" } });
    return { type: "DOCUMENT" as const, id: document.id, kind: document.documentKind, status: document.status,
      latestActivityDate: (await latestDocumentActivity(tx, [document.id]))?.toISOString().slice(0, 10) ?? null,
      settled: balances[0]?.settledAmount.toFixed(2) ?? "0.00", activeAdjustments: String(activeAdjustments), schedules: String(schedules) };
  }
  const settlement = await tx.accountingSettlement.findUnique({ where: { postingJournalId: journalId } });
  if (settlement) {
    const allocations = await tx.accountingSettlementAllocation.findMany({ where: { accountingSettlementId: settlement.id }, select: { accountingDocumentId: true } });
    return { type: "SETTLEMENT" as const, id: settlement.id, kind: settlement.settlementKind, status: settlement.status,
      latestActivityDate: (await latestDocumentActivity(tx, allocations.map(row => row.accountingDocumentId)))?.toISOString().slice(0, 10) ?? null,
      bankTransactionId: settlement.bankTransactionId, amount: settlement.amount.toFixed(2) };
  }
  const adjustment = await tx.accountingDocumentAdjustment.findUnique({ where: { adjustmentJournalId: journalId },
    include: { relFkAccDocAdjustDoc: true } });
  if (adjustment) {
    const balance = (await liveOutstanding(tx, "RECEIVABLE", [adjustment.accountingDocumentId]))[0];
    return { type: "ADJUSTMENT" as const, id: adjustment.id, status: adjustment.relFkAccDocAdjustDoc.status,
      latestActivityDate: (await latestDocumentActivity(tx, [adjustment.accountingDocumentId]))?.toISOString().slice(0, 10) ?? null,
      adjustmentKind: adjustment.adjustmentKind, amount: adjustment.amount.toFixed(2), outstanding: balance?.outstanding.toFixed(2) ?? "0.00" };
  }
  return null;
}
export async function validateAparReversal(tx: Prisma.TransactionClient, journalId: string, accountingDate: Date) {
  const context = await aparReversalContext(tx, journalId);
  if (context?.latestActivityDate && accountingDate < new Date(context.latestActivityDate)) {
    throw new HttpError(409, "Reversal cannot predate existing posted document activity.");
  }
  if (context?.type === "DOCUMENT" && (context.status !== "RECOGNIZED" || accountingTotalCents(context.settled) !== 0n
    || context.activeAdjustments !== "0" || context.schedules !== "0")) {
    throw new HttpError(409, "Reverse valid settlements/adjustments and resolve dependent schedules before reversing this invoice.");
  }
  if (context?.type === "SETTLEMENT" && context.status !== "POSTED") throw new HttpError(409, "Settlement is no longer active.");
  if (context?.type === "ADJUSTMENT" && (context.status !== "RECOGNIZED"
    || context.adjustmentKind === "INCREASE" && accountingTotalCents(context.outstanding) < accountingCents(context.amount))) {
    throw new HttpError(409, "Adjustment reversal would create an invalid receivable balance.");
  }
  return context;
}
export async function applyAparReversal(tx: Prisma.TransactionClient, journalId: string, actorId: string) {
  // Eligibility was checked before the compensating journal was inserted.
  // Recomputing that test here would include the reversal's own financial effect.
  const context = await aparReversalContext(tx, journalId);
  if (context?.type === "DOCUMENT") await tx.accountingDocument.update({ where: { id: context.id }, data: { status: "VOID" } });
  if (context?.type === "SETTLEMENT") {
    await tx.accountingSettlement.update({ where: { id: context.id }, data: { status: "VOID" } });
    if (context.bankTransactionId) await bankMatchHistory(tx, context.id, context.bankTransactionId, actorId, "Active settlement match released by approved reversal; historical source link retained.", true);
  }
}
