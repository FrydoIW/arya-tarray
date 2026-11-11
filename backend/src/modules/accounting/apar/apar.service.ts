import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { centsToDecimal } from "../../../lib/money.js";
import { accountingDateValue, accountingTotalCents } from "../accounting.domain.js";
import { appendApprovalHistory, hasAccountingPermission, loadApproval, requireAccountingPermission } from "../approval/approval.repository.js";
import { invalidateRequests, postApprovedJournalInTransaction, submitApproval } from "../approval/approval.service.js";
import { aparSourceIdentity } from "./apar-source.repository.js";
import { AP_MANAGE, AR_MANAGE, managementCode, SETTLEMENT_MATCH, exactDocumentTotal, validateAllocations, agingBucket } from "./apar.domain.js";
import { aparTransaction, createDocumentRecord, createSettlementRecord, documentRelatedRecords,
  listDocumentRecords, listSettlementRecords, liveOutstanding, loadControlReconciliation, loadDocument,
  loadOutstandingReport, loadSettlement, replaceDocumentRecord, replaceSettlementRecord } from "./apar.repository.js";
import { bankMatchHistory, prepareAparPosting, validateBankMatch, validateDocumentSource } from "./apar-posting.service.js";
import type { AdjustmentInput, AsOfQuery, DocumentInput, DocumentKind, SettlementInput, SubledgerQuery } from "./apar.schema.js";

async function requireManagement(tx: Prisma.TransactionClient, actorId: string) {
  if (!await hasAccountingPermission(tx, actorId, AP_MANAGE) && !await hasAccountingPermission(tx, actorId, AR_MANAGE)) {
    throw new HttpError(403, "AP or AR management permission is required.");
  }
}
const read = (tx: Prisma.TransactionClient, actorId: string) => requireAccountingPermission(tx, actorId, "ACCOUNTING_REPORT");
export function createCounterparty(actorId: string, input: { counterpartyCode: string; displayName: string;
  counterpartyType: string; memberId: string | null; activeFlag: boolean }) {
  return aparTransaction(async tx => {
    await requireManagement(tx, actorId);
    return tx.accountingCounterparty.create({ data: input });
  });
}
export function updateCounterparty(actorId: string, id: string, input: { displayName?: string; activeFlag?: boolean }) {
  return aparTransaction(async tx => {
    await requireManagement(tx, actorId);
    if (!await tx.accountingCounterparty.findUnique({ where: { id }, select: { id: true } })) throw new HttpError(404, "Counterparty was not found.");
    return tx.accountingCounterparty.update({ where: { id }, data: input });
  });
}
export function listCounterparties(actorId: string, query: { search?: string; page: number; pageSize: number }) {
  return aparTransaction(async tx => {
    await read(tx, actorId);
    const where = query.search ? { OR: [{ counterpartyCode: { contains: query.search } }, { displayName: { contains: query.search } }] } : {};
    const [total, rows] = await Promise.all([tx.accountingCounterparty.count({ where }), tx.accountingCounterparty.findMany({ where,
      orderBy: [{ counterpartyCode: "asc" }, { id: "asc" }], take: query.pageSize, skip: (query.page - 1) * query.pageSize })]);
    return { ...query, total, rows };
  });
}
export function getCounterparty(actorId: string, id: string) {
  return aparTransaction(async tx => {
    await read(tx, actorId);
    const row = await tx.accountingCounterparty.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, "Counterparty was not found.");
    return row;
  });
}
function documentResponse(document: Awaited<ReturnType<typeof loadDocument>>) {
  return { ...document, documentDate: accountingDateValue(document.documentDate),
    accountingDate: accountingDateValue(document.accountingDate), dueDate: accountingDateValue(document.dueDate),
    originalAmount: exactDocumentTotal(document.revFkAccDocLineDoc),
    lines: document.revFkAccDocLineDoc.map(line => ({ ...line, amount: line.amount.toFixed(2) })),
    revFkAccDocLineDoc: undefined };
}
export function bankReconciliationState(settlement: { status: string; bankTransactionId: string | null;
  relFkAccSettlementBank: { status: string; reconciliationExcludedAt: Date | null; statementUpload: { status: string } } | null }) {
  if (settlement.status === "VOID") return "VOID";
  if (settlement.status === "DRAFT") return settlement.bankTransactionId ? "DRAFT_RESERVED" : "DRAFT";
  if (!settlement.bankTransactionId) return "AWAITING_STATEMENT";
  const bank = settlement.relFkAccSettlementBank;
  if (!bank || bank.reconciliationExcludedAt || bank.statementUpload.status === "WITHDRAWN") return "BANK_REVIEW_REQUIRED";
  return bank.status === "FINALIZED" && bank.statementUpload.status === "FINALIZED" ? "RECONCILED" : "MATCHED_PENDING_FINALIZATION";
}
function settlementResponse(settlement: Awaited<ReturnType<typeof loadSettlement>>) {
  return { ...settlement, amount: settlement.amount.toFixed(2), settlementDate: accountingDateValue(settlement.settlementDate),
    reconciliationState: bankReconciliationState(settlement),
    allocations: settlement.revFkAccAllocationSettlement.map(row => ({ ...row, allocatedAmount: row.allocatedAmount.toFixed(2) })),
    revFkAccAllocationSettlement: undefined };
}
export function createDocument(actorId: string, kind: DocumentKind, input: DocumentInput) {
  return aparTransaction(async tx => {
    await requireAccountingPermission(tx, actorId, managementCode(kind));
    const document = await createDocumentRecord(tx, kind, actorId, input);
    await validateDocumentSource(tx, document);
    return documentResponse(document);
  });
}
export function updateDocument(actorId: string, kind: DocumentKind, id: string, input: DocumentInput & { expectedRevision: number }) {
  return aparTransaction(async tx => {
    await requireAccountingPermission(tx, actorId, managementCode(kind));
    const existing = await loadDocument(tx, id, kind);
    if (existing.createdById !== actorId) throw new HttpError(403, "Only the document creator may revise it.");
    const document = await replaceDocumentRecord(tx, id, input.expectedRevision, input);
    await validateDocumentSource(tx, document);
    await invalidateRequests(tx, id, actorId);
    return documentResponse(document);
  });
}
export function getDocument(actorId: string, kind: DocumentKind, id: string) {
  return aparTransaction(async tx => {
    await read(tx, actorId);
    const document = await loadDocument(tx, id, kind);
    const [balances, related] = await Promise.all([liveOutstanding(tx, kind, [id]), documentRelatedRecords(tx, id)]);
    return { ...documentResponse(document), outstanding: balances[0]?.outstanding.toFixed(2) ?? "0.00",
      financialState: balances.length ? "POSTED" : document.recognitionJournalId ? "REVERSED" : "UNPOSTED", ...related };
  });
}
export function listDocuments(actorId: string, kind: DocumentKind, query: SubledgerQuery) {
  return aparTransaction(async tx => {
    await read(tx, actorId);
    const result = await listDocumentRecords(tx, kind, query);
    const totals = new Map(result.totals.map(row => [row.accountingDocumentId, row._sum.amount?.toFixed(2) ?? "0.00"]));
    return { ...query, total: result.total, rows: result.rows.map(row => ({ ...row,
      originalAmount: totals.get(row.id) ?? "0.00", accountingDate: accountingDateValue(row.accountingDate),
      documentDate: accountingDateValue(row.documentDate), dueDate: accountingDateValue(row.dueDate) })) };
  });
}
export function createSettlement(actorId: string, kind: DocumentKind, input: SettlementInput) {
  return aparTransaction(async tx => {
    await requireAccountingPermission(tx, actorId, managementCode(kind));
    validateAllocations(input.amount, input.allocations);
    const settlement = await createSettlementRecord(tx, kind, actorId, input);
    await prepareAparPosting(tx, { requestKind: "SETTLEMENT", sourceDocumentId: settlement.id }, actorId);
    return settlementResponse(settlement);
  });
}
export function updateSettlement(actorId: string, kind: DocumentKind, id: string, input: SettlementInput & { expectedRevision: number }) {
  return aparTransaction(async tx => {
    await requireAccountingPermission(tx, actorId, managementCode(kind));
    const existing = await loadSettlement(tx, id, kind);
    if (existing.createdById !== actorId) throw new HttpError(403, "Only the settlement creator may revise it.");
    validateAllocations(input.amount, input.allocations);
    const settlement = await replaceSettlementRecord(tx, id, kind, input.expectedRevision, input);
    await prepareAparPosting(tx, { requestKind: "SETTLEMENT", sourceDocumentId: id }, actorId);
    await invalidateRequests(tx, id, actorId);
    return settlementResponse(settlement);
  });
}
export function getSettlement(actorId: string, kind: DocumentKind, id: string) {
  return aparTransaction(async tx => {
    await read(tx, actorId);
    return settlementResponse(await loadSettlement(tx, id, kind));
  });
}
export function listSettlements(actorId: string, kind: DocumentKind, query: SubledgerQuery) {
  return aparTransaction(async tx => {
    await read(tx, actorId);
    const result = await listSettlementRecords(tx, kind, query);
    return { ...query, total: result.total, rows: result.rows.map(row => ({ ...row, amount: row.amount.toFixed(2),
      settlementDate: accountingDateValue(row.settlementDate), reconciliationState: bankReconciliationState(row) })) };
  });
}
export async function submitSource(actorId: string, kind: DocumentKind, type: "DOCUMENT" | "SETTLEMENT", id: string, expectedRevision: number) {
  if (type === "SETTLEMENT") await aparTransaction(async tx => { await read(tx, actorId); await loadSettlement(tx, id, kind); });
  return submitApproval(actorId, { kind: type === "SETTLEMENT" ? "SETTLEMENT" : kind === "PAYABLE" ? "AP_INVOICE" : "AR_DOCUMENT",
    sourceDocumentId: id, expectedRevision });
}
export function postSource(actorId: string, kind: DocumentKind, type: "DOCUMENT" | "SETTLEMENT", id: string, approvalRequestId: string) {
  return aparTransaction(async tx => {
    const source = type === "DOCUMENT" ? await loadDocument(tx, id, kind) : await loadSettlement(tx, id, kind);
    const request = await loadApproval(tx, approvalRequestId);
    const expected = type === "SETTLEMENT" ? "SETTLEMENT" : kind === "PAYABLE" ? "AP_INVOICE" : "AR_DOCUMENT";
    if (request.sourceDocumentId !== source.id || request.requestKind !== expected) throw new HttpError(409, "Approval does not belong to this AP/AR source.");
    return postApprovedJournalInTransaction(tx, actorId, approvalRequestId);
  });
}
export function requestArAdjustment(actorId: string, id: string, input: AdjustmentInput) {
  return submitApproval(actorId, { kind: "AR_ADJUSTMENT", sourceDocumentId: id, ...input });
}
export async function requestSourceReversal(actorId: string, kind: DocumentKind, type: "DOCUMENT" | "SETTLEMENT", id: string,
  input: { accountingDate: string; remark: string }) {
  const journalId = await aparTransaction(async tx => {
    await requireAccountingPermission(tx, actorId, managementCode(kind));
    if (type === "DOCUMENT") {
      const document = await loadDocument(tx, id, kind);
      if (document.status !== "RECOGNIZED" || !document.recognitionJournalId) throw new HttpError(409, "Only a recognized document can be reversed.");
      return document.recognitionJournalId;
    }
    const settlement = await loadSettlement(tx, id, kind);
    if (settlement.status !== "POSTED" || !settlement.postingJournalId) throw new HttpError(409, "Only a posted settlement can be reversed.");
    return settlement.postingJournalId;
  });
  return submitApproval(actorId, { kind: "JOURNAL_REVERSAL", sourceDocumentId: journalId, ...input });
}
export function cancelSource(actorId: string, kind: DocumentKind, type: "DOCUMENT" | "SETTLEMENT", id: string, expectedRevision: number, reason: string) {
  return aparTransaction(async tx => {
    await requireAccountingPermission(tx, actorId, managementCode(kind));
    const source = type === "DOCUMENT" ? await loadDocument(tx, id, kind) : await loadSettlement(tx, id, kind);
    if (source.createdById !== actorId) throw new HttpError(403, "Only the creator may withdraw a source draft.");
    if (source.status !== "DRAFT" || source.revision !== expectedRevision) throw new HttpError(409, "Only the current unposted draft can be cancelled; posted sources require approved reversal.");
    const requestKind = type === "SETTLEMENT" ? "SETTLEMENT" : kind === "PAYABLE" ? "AP_INVOICE" : "AR_DOCUMENT";
    const identity = await aparSourceIdentity(tx, { requestKind, sourceDocumentId: id });
    let active = await tx.accountingApprovalRequest.findMany({ where: { sourceDocumentId: id, status: { in: ["PENDING", "APPROVED"] } } });
    if (!active.length) {
      const latest = await tx.accountingApprovalRequest.aggregate({ where: { sourceDocumentId: id, requestKind }, _max: { sourceVersion: true } });
      const auditRequest = await tx.accountingApprovalRequest.create({ data: { requestKind, sourceDocumentId: id,
        sourceVersion: Math.max(source.revision, (latest._max.sourceVersion ?? 0) + 1), sourceDigest: identity.sourceDigest,
        requestedById: actorId, ...(type === "DOCUMENT" ? { accountingDocumentId: id } : { accountingSettlementId: id }),
        history: { create: { action: "SUBMIT", statusAfter: "PENDING", actorId, sourceDigest: identity.sourceDigest,
          remark: "Audit record for unposted source withdrawal; no financial approval granted." } } } });
      active = [auditRequest];
    }
    for (const request of active) {
      const changed = await tx.accountingApprovalRequest.updateMany({ where: { id: request.id, status: request.status }, data: { status: "CANCELLED" } });
      if (changed.count !== 1) throw new HttpError(409, "Approval changed during cancellation.");
      await appendApprovalHistory(tx, { approvalRequestId: request.id, action: "CANCEL", statusBefore: request.status,
        statusAfter: "CANCELLED", actorId, sourceDigest: request.sourceDigest, remark: reason });
    }
    if (type === "DOCUMENT") await tx.accountingDocument.update({ where: { id }, data: { status: "VOID" } });
    else await tx.accountingSettlement.update({ where: { id }, data: { status: "VOID" } });
    return { id, status: "VOID", financialJournalCreated: false };
  });
}
export function matchSettlement(actorId: string, kind: DocumentKind, id: string, bankTransactionId: string, remark: string) {
  return aparTransaction(async tx => {
    await requireAccountingPermission(tx, actorId, SETTLEMENT_MATCH);
    const settlement = await loadSettlement(tx, id, kind);
    if (settlement.status !== "POSTED" || !settlement.postingJournalId) throw new HttpError(409, "Only a posted unreversed settlement may be matched.");
    if (await tx.accountingJournal.findUnique({ where: { reversalOfJournalId: settlement.postingJournalId }, select: { id: true } })) throw new HttpError(409, "Reversed settlement cannot be matched.");
    if (settlement.bankTransactionId && settlement.bankTransactionId !== bankTransactionId) throw new HttpError(409, "A posted source's historical bank link cannot be replaced; request accounting review.");
    await validateBankMatch(tx, settlement, bankTransactionId);
    if (!settlement.bankTransactionId) {
      await tx.accountingSettlement.update({ where: { id }, data: { bankTransactionId } });
      await bankMatchHistory(tx, id, bankTransactionId, actorId, remark);
    }
    return settlementResponse(await loadSettlement(tx, id, kind));
  });
}
export function outstandingReport(actorId: string, kind: DocumentKind, query: AsOfQuery) {
  return aparTransaction(async tx => {
    await read(tx, actorId);
    const { rows, summary } = await loadOutstandingReport(tx, kind, query);
    const decimal = (value: Prisma.Decimal | undefined) => value?.toFixed(2) ?? "0.00";
    return { ...query, documentKind: kind, total: Number(summary?.total ?? 0), outstanding: decimal(summary?.outstanding),
      negativeBalanceCount: Number(summary?.negativeCount ?? 0),
      aging: { current: decimal(summary?.currentAmount), days1To30: decimal(summary?.days1To30),
        days31To60: decimal(summary?.days31To60), days61To90: decimal(summary?.days61To90), over90: decimal(summary?.over90) },
      rows: rows.map(row => ({ ...row, accountingDate: accountingDateValue(row.accountingDate), dueDate: accountingDateValue(row.dueDate),
        originalAmount: row.originalAmount.toFixed(2), adjustmentAmount: row.adjustmentAmount.toFixed(2),
        settledAmount: row.settledAmount.toFixed(2), outstanding: row.outstanding.toFixed(2),
        agingBucket: agingBucket(query.asOf, accountingDateValue(row.dueDate)) })) };
  });
}
export function controlReconciliation(actorId: string, kind: DocumentKind, query: AsOfQuery) {
  return aparTransaction(async tx => {
    await read(tx, actorId);
    const data = await loadControlReconciliation(tx, kind, query);
    const subledger = new Map(data.subledger.map(row => [row.accountId, accountingTotalCents(row.amount.toFixed(2))]));
    const ledger = new Map(data.ledger.map(row => [row.accountId, accountingTotalCents(row.amount.toFixed(2))]));
    const ids = [...new Set([...subledger.keys(), ...ledger.keys()])];
    if (ids.length > 1000) throw new HttpError(413, "Narrow control reconciliation to a counterparty; more than 1,000 control accounts matched.");
    const rows = ids.sort().map(accountId => { const sub = subledger.get(accountId) ?? 0n, gl = ledger.get(accountId) ?? 0n;
      return { accountId, subledger: centsToDecimal(sub), generalLedger: centsToDecimal(gl), variance: centsToDecimal(sub - gl), reconciled: sub === gl }; });
    return { documentKind: kind, asOf: query.asOf, counterpartyId: query.counterpartyId,
      reconciled: rows.every(row => row.reconciled), rows, basis: "All posted GL control lines versus valid recognition, adjustment and settlement evidence as of the date." };
  });
}
