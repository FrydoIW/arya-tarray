import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { HttpError } from "../../../lib/http.js";
import type { DocumentKind, AsOfQuery, DocumentInput, SettlementInput, SubledgerQuery } from "./apar.schema.js";
import { randomUUID } from "node:crypto";

export async function aparTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(work, { isolationLevel: "Serializable", timeout: 30000 }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2034" && attempt < 2) continue;
        if (error.code === "P2002") throw new HttpError(409, "AP/AR source reference or document version already exists.");
        if (["P2003", "P2004"].includes(error.code)) throw new HttpError(400, "AP/AR references or constraints are invalid.");
      }
      throw error;
    }
  }
}
export const documentInclude = { revFkAccDocLineDoc: { orderBy: { lineNo: "asc" as const } },
  relFkAccDocCounterparty: true, controlAccount: true };
export const settlementInclude = { revFkAccAllocationSettlement: { orderBy: { accountingDocumentId: "asc" as const } },
  bankAccount: true, bankGlAccount: true, relFkAccSettlementCp: true,
  relFkAccSettlementBank: { include: { statementUpload: true } } };
export async function loadDocument(tx: Prisma.TransactionClient, id: string, kind?: DocumentKind) {
  const row = await tx.accountingDocument.findUnique({ where: { id }, include: documentInclude });
  if (!row || (kind && row.documentKind !== kind)) throw new HttpError(404, "AP/AR document was not found.");
  return row;
}
export async function loadSettlement(tx: Prisma.TransactionClient, id: string, kind?: DocumentKind) {
  const row = await tx.accountingSettlement.findUnique({ where: { id }, include: settlementInclude });
  if (!row || (kind && row.settlementKind !== kind)) throw new HttpError(404, "AP/AR settlement was not found.");
  return row;
}
const dateValue = (value: string) => new Date(`${value}T00:00:00.000Z`);
const documentData = (input: DocumentInput) => ({ counterpartyId: input.counterpartyId, controlAccountId: input.controlAccountId,
  accrualDraftId: input.accrualDraftId ?? null,
  documentNumber: input.documentNumber, sourceReference: input.sourceReference, recognitionBasis: input.recognitionBasis,
  documentDate: dateValue(input.documentDate), accountingDate: dateValue(input.accountingDate), dueDate: dateValue(input.dueDate) });
const documentLines = (input: DocumentInput) => input.lines.map((line, index) => ({ id: randomUUID(), lineNo: index + 1, ...line }));
export function createDocumentRecord(tx: Prisma.TransactionClient, kind: DocumentKind, actorId: string, input: DocumentInput) {
  return tx.accountingDocument.create({ data: { ...documentData(input), documentKind: kind, createdById: actorId,
    revFkAccDocLineDoc: { create: documentLines(input) } }, include: documentInclude });
}
export async function replaceDocumentRecord(tx: Prisma.TransactionClient, id: string, revision: number, input: DocumentInput) {
  const changed = await tx.accountingDocument.updateMany({ where: { id, status: "DRAFT", revision },
    data: { ...documentData(input), revision: { increment: 1 } } });
  if (changed.count !== 1) throw new HttpError(409, "Document revision changed or is immutable.");
  await tx.accountingDocumentLine.deleteMany({ where: { accountingDocumentId: id } });
  await tx.accountingDocumentLine.createMany({ data: documentLines(input).map(line => ({ ...line, accountingDocumentId: id })) });
  return loadDocument(tx, id);
}
const settlementData = (input: SettlementInput) => ({ counterpartyId: input.counterpartyId, bankAccountId: input.bankAccountId,
  bankGlAccountId: input.bankGlAccountId, sourceReference: input.sourceReference, settlementReference: input.settlementReference,
  settlementDate: dateValue(input.settlementDate), amount: input.amount, bankTransactionId: input.bankTransactionId });
const allocationsData = (input: SettlementInput, kind: DocumentKind) => input.allocations.map(allocation => ({
  ...allocation, counterpartyId: input.counterpartyId, documentKind: kind }));
export async function createSettlementRecord(tx: Prisma.TransactionClient, kind: DocumentKind, actorId: string, input: SettlementInput) {
  const settlement = await tx.accountingSettlement.create({ data: { ...settlementData(input), settlementKind: kind, createdById: actorId } });
  await tx.accountingSettlementAllocation.createMany({ data: allocationsData(input, kind).map(row => ({ ...row, accountingSettlementId: settlement.id })) });
  return loadSettlement(tx, settlement.id);
}
export async function replaceSettlementRecord(tx: Prisma.TransactionClient, id: string, kind: DocumentKind, revision: number, input: SettlementInput) {
  const changed = await tx.accountingSettlement.updateMany({ where: { id, status: "DRAFT", revision },
    data: { ...settlementData(input), revision: { increment: 1 } } });
  if (changed.count !== 1) throw new HttpError(409, "Settlement revision changed or is immutable.");
  await tx.accountingSettlementAllocation.deleteMany({ where: { accountingSettlementId: id } });
  await tx.accountingSettlementAllocation.createMany({ data: allocationsData(input, kind).map(row => ({ ...row, accountingSettlementId: id })) });
  return loadSettlement(tx, id);
}
export async function listDocumentRecords(tx: Prisma.TransactionClient, kind: DocumentKind, query: SubledgerQuery) {
  const where: Prisma.AccountingDocumentWhereInput = { documentKind: kind, counterpartyId: query.counterpartyId,
    status: query.status, documentNumber: query.search ? { contains: query.search } : undefined };
  const [total, rows] = await Promise.all([tx.accountingDocument.count({ where }), tx.accountingDocument.findMany({ where,
    orderBy: [{ accountingDate: "desc" }, { id: "desc" }], take: query.pageSize, skip: (query.page - 1) * query.pageSize,
    include: { relFkAccDocCounterparty: { select: { id: true, displayName: true } } } })]);
  const totals = rows.length ? await tx.accountingDocumentLine.groupBy({ by: ["accountingDocumentId"],
    where: { accountingDocumentId: { in: rows.map(row => row.id) } }, _sum: { amount: true } }) : [];
  return { total, rows, totals };
}
export async function listSettlementRecords(tx: Prisma.TransactionClient, kind: DocumentKind, query: SubledgerQuery) {
  const where: Prisma.AccountingSettlementWhereInput = { settlementKind: kind, counterpartyId: query.counterpartyId,
    status: query.status, settlementReference: query.search ? { contains: query.search } : undefined };
  const [total, rows] = await Promise.all([tx.accountingSettlement.count({ where }), tx.accountingSettlement.findMany({ where,
    orderBy: [{ settlementDate: "desc" }, { id: "desc" }], take: query.pageSize, skip: (query.page - 1) * query.pageSize,
    include: { relFkAccSettlementBank: { include: { statementUpload: true } } } })]);
  return { total, rows };
}
export async function documentRelatedRecords(tx: Prisma.TransactionClient, id: string) {
  const [allocations, adjustments, approvals] = await Promise.all([
    tx.accountingSettlementAllocation.findMany({ where: { accountingDocumentId: id }, take: 500, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { relFkAccAllocationSettlement: { select: { id: true, settlementReference: true, settlementDate: true,
        status: true, postingJournalId: true } } } }),
    tx.accountingDocumentAdjustment.findMany({ where: { accountingDocumentId: id }, take: 500, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    tx.accountingApprovalRequest.findMany({ where: { sourceDocumentId: id }, take: 500, orderBy: [{ requestedAt: "asc" }, { id: "asc" }] })
  ]);
  return { allocations, adjustments, approvals, relatedRecordsLimit: 500 };
}
export async function lockBankTransaction(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT bank_transaction_id FROM arya_bank_transaction WHERE bank_transaction_id=${id} FOR UPDATE`;
  const row = await tx.bankTransaction.findUnique({ where: { id }, include: {
    statementUpload: { include: { bankAccount: true } },
    accountingJournals: { include: { revFkAccJournalReversal: { select: { id: true } } } }
  } });
  if (!row) throw new HttpError(404, "Imported bank transaction was not found.");
  return row;
}
export function activeSettlementsForBank(tx: Prisma.TransactionClient, bankTransactionId: string, exceptId: string) {
  return tx.accountingSettlement.findMany({ where: { bankTransactionId, id: { not: exceptId }, status: "POSTED",
    relFkAccSettlementJournal: { is: { revFkAccJournalReversal: { is: null } } } }, select: { id: true } });
}
export function settlementReservationState(tx: Prisma.TransactionClient, ids: string[]) {
  return tx.accountingSettlement.findMany({ where: { bankTransactionId: { in: ids }, status: { in: ["DRAFT", "POSTED"] } },
    select: { id: true, status: true, bankTransactionId: true, postingJournalId: true,
      relFkAccSettlementJournal: { select: { revFkAccJournalReversal: { select: { id: true } } } } } });
}

export type OutstandingRow = {
  id: string; documentKind: string; documentNumber: string; counterpartyId: string; controlAccountId: string;
  accountingDate: Date; dueDate: Date; recognitionJournalId: string;
  originalAmount: Prisma.Decimal; adjustmentAmount: Prisma.Decimal; settledAmount: Prisma.Decimal; outstanding: Prisma.Decimal;
};
function outstandingSql(kind: DocumentKind, asOf: Date, counterpartyId?: string, ids?: string[]) {
  return Prisma.sql`WITH invoice_totals AS (
    SELECT accounting_document_id AS doc, SUM(amount) AS amount FROM arya_accounting_document_line GROUP BY accounting_document_id
  ), settlement_totals AS (
    SELECT a.accounting_document_id AS doc, SUM(a.allocated_amount) AS amount
    FROM arya_accounting_settlement_allocation a JOIN arya_accounting_settlement s USING(accounting_settlement_id)
    JOIN arya_accounting_journal j ON j.accounting_journal_id=s.posting_journal_id
    WHERE s.status IN ('POSTED','VOID') AND j.accounting_date<=${asOf}
      AND j.source_kind IN ('AP_SETTLEMENT','AR_SETTLEMENT') AND j.source_reference=s.accounting_settlement_id
      AND NOT EXISTS (SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id AND r.accounting_date<=${asOf})
    GROUP BY a.accounting_document_id
  ), adjustment_totals AS (
    SELECT a.accounting_document_id AS doc, SUM(CASE WHEN a.adjustment_kind='INCREASE' THEN a.amount ELSE -a.amount END) AS amount
    FROM arya_accounting_document_adjustment a JOIN arya_accounting_journal j ON j.accounting_journal_id=a.adjustment_journal_id
    WHERE j.accounting_date<=${asOf} AND j.source_kind='AR_ADJUSTMENT' AND j.source_reference=a.adjustment_reference
      AND NOT EXISTS (SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id AND r.accounting_date<=${asOf})
    GROUP BY a.accounting_document_id
  ), balances AS (
    SELECT d.accounting_document_id AS id,d.document_kind AS documentKind,d.document_number AS documentNumber,
      d.counterparty_id AS counterpartyId,d.control_account_id AS controlAccountId,
      j.accounting_date AS accountingDate,d.due_date AS dueDate,d.recognition_journal_id AS recognitionJournalId,
      COALESCE(i.amount,0) AS originalAmount,COALESCE(a.amount,0) AS adjustmentAmount,
      COALESCE(s.amount,0) AS settledAmount,COALESCE(i.amount,0)+COALESCE(a.amount,0)-COALESCE(s.amount,0) AS outstanding
    FROM arya_accounting_document d JOIN arya_accounting_journal j ON j.accounting_journal_id=d.recognition_journal_id
    LEFT JOIN invoice_totals i ON i.doc=d.accounting_document_id
    LEFT JOIN adjustment_totals a ON a.doc=d.accounting_document_id LEFT JOIN settlement_totals s ON s.doc=d.accounting_document_id
    WHERE d.document_kind=${kind} AND d.status IN ('RECOGNIZED','VOID') AND j.accounting_date<=${asOf}
      AND j.source_kind IN ('AP_DOCUMENT','AR_DOCUMENT') AND j.source_reference=d.accounting_document_id
      AND NOT EXISTS (SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id AND r.accounting_date<=${asOf})
      ${counterpartyId ? Prisma.sql`AND d.counterparty_id=${counterpartyId}` : Prisma.empty}
      ${ids ? Prisma.sql`AND d.accounting_document_id IN (${Prisma.join(ids)})` : Prisma.empty}
  )`;
}
export async function liveOutstanding(tx: Prisma.TransactionClient, kind: DocumentKind, ids: string[]) {
  if (!ids.length) return [];
  return tx.$queryRaw<OutstandingRow[]>(Prisma.sql`${outstandingSql(kind, new Date("9999-12-31T00:00:00.000Z"), undefined, ids)} SELECT * FROM balances`);
}
export async function loadOutstandingReport(tx: Prisma.TransactionClient, kind: DocumentKind, query: AsOfQuery) {
  const asOf = new Date(`${query.asOf}T00:00:00.000Z`);
  const cte = outstandingSql(kind, asOf, query.counterpartyId);
  const [rows, summary] = await Promise.all([
    tx.$queryRaw<OutstandingRow[]>(Prisma.sql`${cte} SELECT * FROM balances WHERE outstanding<>0 ORDER BY dueDate,id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`),
    tx.$queryRaw<Array<{ total: bigint; outstanding: Prisma.Decimal; currentAmount: Prisma.Decimal;
      days1To30: Prisma.Decimal; days31To60: Prisma.Decimal; days61To90: Prisma.Decimal; over90: Prisma.Decimal; negativeCount: bigint }>>(Prisma.sql`${cte}
      SELECT COUNT(*) AS total,COALESCE(SUM(outstanding),0) AS outstanding,
      COALESCE(SUM(CASE WHEN DATEDIFF(${asOf},dueDate)<=0 THEN outstanding ELSE 0 END),0) AS currentAmount,
      COALESCE(SUM(CASE WHEN DATEDIFF(${asOf},dueDate) BETWEEN 1 AND 30 THEN outstanding ELSE 0 END),0) AS days1To30,
      COALESCE(SUM(CASE WHEN DATEDIFF(${asOf},dueDate) BETWEEN 31 AND 60 THEN outstanding ELSE 0 END),0) AS days31To60,
      COALESCE(SUM(CASE WHEN DATEDIFF(${asOf},dueDate) BETWEEN 61 AND 90 THEN outstanding ELSE 0 END),0) AS days61To90,
      COALESCE(SUM(CASE WHEN DATEDIFF(${asOf},dueDate)>90 THEN outstanding ELSE 0 END),0) AS over90,
      COALESCE(SUM(outstanding<0),0) AS negativeCount FROM balances WHERE outstanding<>0`)
  ]);
  return { rows, summary: summary[0] };
}
export async function loadControlReconciliation(tx: Prisma.TransactionClient, kind: DocumentKind, query: AsOfQuery) {
  const asOf = new Date(`${query.asOf}T00:00:00.000Z`);
  const [subledger, ledger] = await Promise.all([
    tx.$queryRaw<Array<{ accountId: string; amount: Prisma.Decimal }>>(Prisma.sql`${outstandingSql(kind, asOf, query.counterpartyId)}
      SELECT controlAccountId AS accountId,SUM(outstanding) AS amount FROM balances GROUP BY controlAccountId`),
    tx.$queryRaw<Array<{ accountId: string; amount: Prisma.Decimal }>>(Prisma.sql`
      SELECT l.accounting_account_id AS accountId,SUM(${kind === "PAYABLE" ? Prisma.sql`l.credit-l.debit` : Prisma.sql`l.debit-l.credit`}) AS amount
      FROM arya_accounting_journal_line l JOIN arya_accounting_journal j USING(accounting_journal_id)
      WHERE j.accounting_date<=${asOf} AND l.accounting_account_id IN
        (SELECT DISTINCT control_account_id FROM arya_accounting_document WHERE document_kind=${kind})
        ${query.counterpartyId ? Prisma.sql`AND l.counterparty_id=${query.counterpartyId}` : Prisma.empty}
      GROUP BY l.accounting_account_id`)
  ]);
  return { subledger, ledger };
}

export async function latestDocumentActivity(tx: Prisma.TransactionClient, ids: string[]) {
  if (!ids.length) return null;
  const rows = await tx.$queryRaw<Array<{ latest: Date | null }>>(Prisma.sql`
    WITH activity AS (
      SELECT recognition_journal_id AS journal FROM arya_accounting_document WHERE accounting_document_id IN (${Prisma.join(ids)})
      UNION ALL SELECT s.posting_journal_id FROM arya_accounting_settlement_allocation a
        JOIN arya_accounting_settlement s USING(accounting_settlement_id) WHERE a.accounting_document_id IN (${Prisma.join(ids)})
      UNION ALL SELECT adjustment_journal_id FROM arya_accounting_document_adjustment WHERE accounting_document_id IN (${Prisma.join(ids)})
    ) SELECT MAX(GREATEST(j.accounting_date,COALESCE(r.accounting_date,j.accounting_date))) AS latest
      FROM activity a JOIN arya_accounting_journal j ON j.accounting_journal_id=a.journal
      LEFT JOIN arya_accounting_journal r ON r.reversal_of_journal_id=j.accounting_journal_id`);
  return rows[0]?.latest ?? null;
}
export async function requireChronologicalDocumentActivity(tx: Prisma.TransactionClient, ids: string[], date: Date) {
  const latest = await latestDocumentActivity(tx, ids);
  if (latest && date < latest) throw new HttpError(409, "Accounting date cannot predate existing posted document activity; preserve historical outstanding balances.");
}
