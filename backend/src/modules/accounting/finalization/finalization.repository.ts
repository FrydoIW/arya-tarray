import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { randomUUID } from "node:crypto";
import { aparTransaction } from "../apar/apar.repository.js";
import { requireAccountingPermission, ACCOUNTING_MANAGE } from "../approval/approval.repository.js";
import { material, digest } from "../funds/fund.repository.js";
import { day, dateText, cents, money } from "../funds/fund.domain.js";
import { policySchema } from "./finalization.schema.js";
export { material, digest, day, dateText, cents, money };
export const readAccounting = <T>(actor: string, work: (tx: Prisma.TransactionClient) => Promise<T>) => aparTransaction(async tx => { await requireAccountingPermission(tx, actor, "ACCOUNTING_REPORT"); return work(tx); });
export const manageAccounting = <T>(actor: string, work: (tx: Prisma.TransactionClient) => Promise<T>) => aparTransaction(async tx => { await requireAccountingPermission(tx, actor, ACCOUNTING_MANAGE); return work(tx); });
export async function yearById(tx: Prisma.TransactionClient, id: string) { const row = await tx.accountingFiscalYear.findUnique({ where: { id } }); if (!row) throw new HttpError(404, "Fiscal year not found."); return row; }
export async function periodById(tx: Prisma.TransactionClient, id: string) { const row = await tx.accountingPeriod.findUnique({ where: { id } }); if (!row) throw new HttpError(404, "Accounting period not found."); return row; }
export async function finalDraft(tx: Prisma.TransactionClient, id: string) { const row = await tx.accountingJournalDraft.findUnique({ where: { id } }); if (!row || row.finalizationMetadata === null) throw new HttpError(404, "Finalization source not found."); return row; }
export async function currentPolicy(tx: Prisma.TransactionClient, fiscalYearId: string) {
  const year = await yearById(tx, fiscalYearId), draft = year.reportingPolicyDraftId ? await finalDraft(tx, year.reportingPolicyDraftId) : null;
  return { year, draft, policy: draft?.status === "APPLIED" && draft.sourceKind === "REPORTING_POLICY" ? policySchema.parse(draft.finalizationMetadata) : null };
}
export async function newFinalDraft(tx: Prisma.TransactionClient, actor: string, kind: string, date: Date, metadata: unknown,
  links: { fiscalYearId?: string; accountingPeriodId?: string; bankReconciliationId?: string } = {}) {
  const id = randomUUID(); return tx.accountingJournalDraft.create({ data: { id, draftNumber: `FIN-${id}`, sourceKind: kind, sourceReference: id, journalType: "ADJUSTMENT", accountingDate: date,
    finalizationMetadata: material(metadata), createdById: actor, ...links } });
}
export async function auditFinal(tx: Prisma.TransactionClient, actor: string, action: string, metadata: unknown, links: Parameters<typeof newFinalDraft>[5] = {}) {
  const row = await newFinalDraft(tx, actor, "FINALIZATION_AUDIT", new Date(new Date().toISOString().slice(0, 10)), { action, detail: metadata }, links);
  await tx.accountingJournalDraft.update({ where: { id: row.id }, data: { status: "APPLIED" } }); return row.id;
}
export async function ledgerFingerprint(tx: Prisma.TransactionClient, from: Date, to: Date) {
  const rows = await tx.$queryRaw<{ id: string; value: string }[]>`SELECT l.accounting_journal_line_id AS id,SHA2(CONCAT_WS('|',j.accounting_journal_id,j.source_event_key,j.journal_type,j.accounting_date,j.accounting_period_id,COALESCE(j.reversal_of_journal_id,''),l.accounting_account_id,l.debit,l.credit,COALESCE(l.accounting_fund_id,''),COALESCE(l.fund_restriction_id,''),COALESCE(l.bank_account_id,''),COALESCE(l.event_campaign_id,''),COALESCE(l.counterparty_id,''),COALESCE(l.member_identity_id,''),COALESCE(l.member_id,'')),256) AS value FROM arya_accounting_journal j JOIN arya_accounting_journal_line l USING(accounting_journal_id) WHERE j.accounting_date>=${from} AND j.accounting_date<=${to} ORDER BY l.accounting_journal_line_id LIMIT 200001`;
  if (rows.length > 200000) throw new HttpError(413, "Ledger evidence scope exceeds 200,000 lines; reviewed batch evidence required."); return digest(rows);
}
