import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { accountingCents } from "../accounting.domain.js";
import { centsToDecimal } from "../../../lib/money.js";
import { accrualMetadataSchema } from "./schedule.schema.js";
import type { PlanRow } from "./schedule.schema.js";
import { day } from "./schedule.domain.js";
export const scheduleInclude = { revFkAccSchedulePeriodParent: { orderBy: [{ recognitionDate: "asc" as const }, { id: "asc" as const }],
  include: { relFkAccSchedulePeriodJournal: { include: { revFkAccJournalReversal: true } } } },
  relFkAccScheduleSource: { include: { journal: { include: { revFkAccJournalReversal: true } } } }, terminationJournal: { include: { revFkAccJournalReversal: true } } };
export async function loadSchedule(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.accountingSchedule.findUnique({ where: { id }, include: scheduleInclude });
  if (!row) throw new HttpError(404, "Accounting schedule was not found."); return row;
}
export async function loadSchedulePeriod(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.accountingSchedulePeriod.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Schedule period was not found."); return { row, schedule: await loadSchedule(tx, row.accountingScheduleId) };
}
export function scheduleAmounts(schedule: Awaited<ReturnType<typeof loadSchedule>>) {
  const recognized = schedule.revFkAccSchedulePeriodParent.reduce((n, p) => n + (p.relFkAccSchedulePeriodJournal && !p.relFkAccSchedulePeriodJournal.revFkAccJournalReversal ? accountingCents(p.plannedAmount) : 0n), 0n);
  const terminated = schedule.terminationJournal && !schedule.terminationJournal.revFkAccJournalReversal ? accountingCents(schedule.plannedAmount) - recognized : 0n;
  return { recognized: centsToDecimal(recognized), terminated: centsToDecimal(terminated), remaining: centsToDecimal(accountingCents(schedule.plannedAmount) - recognized - terminated) };
}
export async function lockAccrual(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT journal_draft_id FROM arya_accounting_journal_draft WHERE journal_draft_id=${id} FOR UPDATE`;
}
export async function loadAccrual(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.accountingJournalDraft.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } }, postedJournal: { include: { revFkAccJournalReversal: true } } } });
  if (!row || row.sourceKind !== "ACCRUAL_DOCUMENT") throw new HttpError(404, "Accrual document was not found.");
  const parsed = accrualMetadataSchema.safeParse(row.accrualMetadata);
  if (!parsed.success || row.lines.length !== 2) throw new HttpError(409, "Accrual document metadata is invalid.");
  const expense = parsed.data.kind === "ACCRUED_EXPENSE";
  const balance = row.lines[expense ? 1 : 0], recognition = row.lines[expense ? 0 : 1];
  if (!balance || !recognition) throw new HttpError(409, "Accrual account mapping is incomplete.");
  return { ...row, metadata: parsed.data, balance, recognition };
}
export async function accrualAmounts(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<Array<{ recognized: Prisma.Decimal; cleared: Prisma.Decimal }>>`
    WITH effects AS (
      SELECT CASE WHEN d.source_kind='ACCRUAL_DOCUMENT' THEN l.debit+l.credit
        WHEN JSON_UNQUOTE(JSON_EXTRACT(d.accrual_metadata,'$.adjustmentKind'))='DECREASE' THEN -(l.debit+l.credit)
        ELSE l.debit+l.credit END AS amount
      FROM arya_accounting_journal_draft d JOIN arya_accounting_journal_draft_line l ON l.journal_draft_id=d.journal_draft_id AND l.line_no=1
      JOIN arya_accounting_journal j ON j.accounting_journal_id=d.posted_journal_id
      WHERE (d.journal_draft_id=${id} OR d.parent_accrual_draft_id=${id})
        AND NOT EXISTS (SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id)
    ), cleared AS (
      SELECT SUM(l.amount) AS amount FROM arya_accounting_document d
      JOIN arya_accounting_document_line l USING(accounting_document_id)
      JOIN arya_accounting_journal j ON j.accounting_journal_id=d.recognition_journal_id
      WHERE d.accrual_draft_id=${id} AND NOT EXISTS
        (SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id)
    ) SELECT COALESCE((SELECT SUM(amount) FROM effects),0) AS recognized,COALESCE((SELECT amount FROM cleared),0) AS cleared`;
  const recognized = rows[0]?.recognized ?? new Prisma.Decimal(0), cleared = rows[0]?.cleared ?? new Prisma.Decimal(0);
  return { recognized: recognized.toFixed(2), cleared: cleared.toFixed(2), remaining: recognized.minus(cleared).toFixed(2) };
}
export async function sourceCapacity(tx: Prisma.TransactionClient, lineId: string, exceptId?: string) {
  await tx.$queryRaw`SELECT accounting_journal_line_id FROM arya_accounting_journal_line WHERE accounting_journal_line_id=${lineId} FOR UPDATE`;
  const source = await tx.accountingJournalLine.findUnique({ where: { id: lineId }, include: { account: true, journal: { include: { revFkAccJournalReversal: true } } } });
  if (!source || source.journal.revFkAccJournalReversal) throw new HttpError(409, "Schedule source must be an actual unreversed posted balance line.");
  const assetClaim = await tx.accountingFixedAsset.findFirst({ where: { acquisitionJournalLineId: lineId, status: { not: "CANCELLED" } }, select: { id: true } });
  const assetChangeClaim = await tx.accountingJournalDraft.findFirst({ where: { OR: [{ assetSourceLineId: lineId }, { assetCostLineId: lineId }], status: { in: ["DRAFT", "APPLIED", "POSTED"] } }, select: { id: true } });
  if (assetClaim || assetChangeClaim) throw new HttpError(409, "Asset-claimed source cannot also fund a recognition schedule.");
  const rows = await tx.$queryRaw<Array<{ amount: Prisma.Decimal }>>`
    SELECT COALESCE(SUM(CASE WHEN s.status='CANCELLED' THEN (
      SELECT COALESCE(SUM(p.planned_amount),0) FROM arya_accounting_schedule_period p
      JOIN arya_accounting_journal j ON j.accounting_journal_id=p.recognition_journal_id
      WHERE p.accounting_schedule_id=s.accounting_schedule_id AND NOT EXISTS
        (SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id)
    ) ELSE s.planned_amount END),0) AS amount
    FROM arya_accounting_schedule s WHERE s.source_journal_line_id=${lineId}
      AND (${exceptId ?? null} IS NULL OR s.accounting_schedule_id<>${exceptId ?? null})`;
  const dates = await tx.$queryRaw<Array<{ latest: Date | null }>>`
    SELECT MAX(GREATEST(j.accounting_date,COALESCE(r.accounting_date,j.accounting_date))) AS latest
    FROM arya_accounting_journal j LEFT JOIN arya_accounting_journal r ON r.reversal_of_journal_id=j.accounting_journal_id
    WHERE j.accounting_journal_id=${source.journalId} OR (j.related_journal_id=${source.journalId}
      AND j.source_kind IN ('SCHEDULE_RECOGNITION','SCHEDULE_TERMINATION'))`;
  return { source, allocated: rows[0]?.amount ?? new Prisma.Decimal(0), latest: dates[0]?.latest ?? source.journal.accountingDate };
}
export async function accrualLedgerBalance(tx: Prisma.TransactionClient, id: string, accountId: string, creditNormal: boolean) {
  const rows = await tx.$queryRaw<Array<{ amount: Prisma.Decimal }>>(Prisma.sql`
    WITH sources AS (SELECT posted_journal_id AS id FROM arya_accounting_journal_draft WHERE journal_draft_id=${id} OR parent_accrual_draft_id=${id}
      UNION ALL SELECT recognition_journal_id FROM arya_accounting_document WHERE accrual_draft_id=${id})
    SELECT COALESCE(SUM(${creditNormal ? Prisma.sql`l.credit-l.debit` : Prisma.sql`l.debit-l.credit`}),0) AS amount
    FROM arya_accounting_journal_line l JOIN arya_accounting_journal j USING(accounting_journal_id)
    WHERE l.accounting_account_id=${accountId} AND (j.accounting_journal_id IN (SELECT id FROM sources)
      OR j.reversal_of_journal_id IN (SELECT id FROM sources))`);
  return rows[0]?.amount.toFixed(2) ?? "0.00";
}
export async function scheduleLedgerRemaining(tx: Prisma.TransactionClient, schedule: Awaited<ReturnType<typeof loadSchedule>>) {
  const rows = await tx.$queryRaw<Array<{ consumed: Prisma.Decimal }>>(Prisma.sql`
    WITH sources AS (SELECT recognition_journal_id AS id FROM arya_accounting_schedule_period WHERE accounting_schedule_id=${schedule.id}
      UNION ALL SELECT applied_journal_id FROM arya_accounting_approval_request WHERE accounting_schedule_id=${schedule.id} AND request_kind='SCHEDULE_TERMINATE' AND status='APPLIED')
    SELECT COALESCE(SUM(${schedule.scheduleKind === "PREPAYMENT" ? Prisma.sql`l.credit-l.debit` : Prisma.sql`l.debit-l.credit`}),0) AS consumed
    FROM arya_accounting_journal_line l JOIN arya_accounting_journal j USING(accounting_journal_id)
    WHERE l.accounting_account_id=${schedule.balanceAccountId} AND (j.accounting_journal_id IN (SELECT id FROM sources)
      OR j.reversal_of_journal_id IN (SELECT id FROM sources))`);
  return schedule.plannedAmount.minus(rows[0]?.consumed ?? 0).toFixed(2);
}
export async function replaceUnpostedPeriods(tx: Prisma.TransactionClient, scheduleId: string, rows: PlanRow[]) {
  await tx.$executeRaw(Prisma.sql`UPDATE arya_accounting_schedule_period SET
    planned_amount=CASE accounting_period_id ${Prisma.join(rows.map(r => Prisma.sql`WHEN ${r.accountingPeriodId} THEN CAST(${r.plannedAmount} AS DECIMAL(20,2))`), " ")} END,
    recognition_date=CASE accounting_period_id ${Prisma.join(rows.map(r => Prisma.sql`WHEN ${r.accountingPeriodId} THEN ${day(r.recognitionDate)}`), " ")} END
    WHERE accounting_schedule_id=${scheduleId} AND recognition_journal_id IS NULL AND accounting_period_id IN (${Prisma.join(rows.map(r => r.accountingPeriodId))})`);
}
