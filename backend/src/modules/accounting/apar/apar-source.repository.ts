import type { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { accountingApprovalDigest } from "../approval/approval.domain.js";
import { accountingDateValue } from "../accounting.domain.js";
import { adjustmentInputSchema } from "./apar.schema.js";
import { loadDocument, loadSettlement } from "./apar.repository.js";
import { managementCode } from "./apar.domain.js";

export const isAparApprovalKind = (kind: string) => ["AP_INVOICE", "AR_DOCUMENT", "SETTLEMENT", "AR_ADJUSTMENT"].includes(kind);
export function documentDigest(document: Awaited<ReturnType<typeof loadDocument>>) {
  return accountingApprovalDigest({ id: document.id, kind: document.documentKind,
    accrualDraftId: document.accrualDraftId,
    revision: String(document.revision), status: document.status, counterpartyId: document.counterpartyId,
    controlAccountId: document.controlAccountId, documentNumber: document.documentNumber,
    sourceReference: document.sourceReference, recognitionBasis: document.recognitionBasis,
    documentDate: accountingDateValue(document.documentDate), accountingDate: accountingDateValue(document.accountingDate),
    dueDate: accountingDateValue(document.dueDate), createdById: document.createdById,
    lines: document.revFkAccDocLineDoc.map(line => ({ lineNo: String(line.lineNo), accountId: line.accountingAccountId,
      description: line.description, amount: line.amount.toFixed(2), accountingFundId: line.accountingFundId,
      eventCampaignId: line.eventCampaignId })) });
}
export function parseAdjustmentPayload(payload: unknown) {
  const parsed = adjustmentInputSchema.safeParse(payload);
  if (!parsed.success) throw new HttpError(409, "AR adjustment approval payload is invalid.");
  return parsed.data;
}
export async function settlementDigest(tx: Prisma.TransactionClient, settlement: Awaited<ReturnType<typeof loadSettlement>>) {
  const documents = await tx.accountingDocument.findMany({ where: {
    id: { in: settlement.revFkAccAllocationSettlement.map(row => row.accountingDocumentId) } },
    select: { id: true, documentKind: true, counterpartyId: true, controlAccountId: true, recognitionJournalId: true } });
  const byId = new Map(documents.map(document => [document.id, document]));
  return accountingApprovalDigest({ id: settlement.id, kind: settlement.settlementKind,
    revision: String(settlement.revision), status: settlement.status, counterpartyId: settlement.counterpartyId,
    bankAccountId: settlement.bankAccountId, bankGlAccountId: settlement.bankGlAccountId,
    bankTransactionId: settlement.bankTransactionId, reference: settlement.settlementReference,
    sourceReference: settlement.sourceReference, date: accountingDateValue(settlement.settlementDate),
    amount: settlement.amount.toFixed(2), createdById: settlement.createdById,
    allocations: settlement.revFkAccAllocationSettlement.map(allocation => ({ documentId: allocation.accountingDocumentId,
      amount: allocation.allocatedAmount.toFixed(2), document: byId.get(allocation.accountingDocumentId) ?? null })) });
}
export async function aparSourceIdentity(tx: Prisma.TransactionClient, request: {
  requestKind: string; sourceDocumentId: string; requestPayload?: unknown;
}) {
  if (request.requestKind === "SETTLEMENT") {
    const settlement = await loadSettlement(tx, request.sourceDocumentId);
    return { sourceVersion: settlement.revision, sourceDigest: await settlementDigest(tx, settlement),
      requesterId: settlement.createdById, managePermission: managementCode(settlement.settlementKind),
      accountingDate: settlement.settlementDate };
  }
  const document = await loadDocument(tx, request.sourceDocumentId);
  if (request.requestKind === "AP_INVOICE" && document.documentKind !== "PAYABLE"
    || ["AR_DOCUMENT", "AR_ADJUSTMENT"].includes(request.requestKind) && document.documentKind !== "RECEIVABLE") {
    throw new HttpError(409, "Accounting approval kind does not match this AP/AR source.");
  }
  const payload = request.requestKind === "AR_ADJUSTMENT" ? parseAdjustmentPayload(request.requestPayload) : null;
  return { sourceVersion: document.revision,
    sourceDigest: payload ? accountingApprovalDigest({ document: documentDigest(document), adjustment: payload }) : documentDigest(document),
    requesterId: document.createdById, managePermission: managementCode(document.documentKind),
    accountingDate: payload ? new Date(`${payload.accountingDate}T00:00:00.000Z`) : document.accountingDate };
}
export async function aparSourceView(tx: Prisma.TransactionClient, request: { requestKind: string; sourceDocumentId: string; requestPayload: unknown }) {
  return request.requestKind === "SETTLEMENT" ? { settlement: await loadSettlement(tx, request.sourceDocumentId) }
    : { document: await loadDocument(tx, request.sourceDocumentId), adjustment: request.requestKind === "AR_ADJUSTMENT"
      ? parseAdjustmentPayload(request.requestPayload) : null };
}
