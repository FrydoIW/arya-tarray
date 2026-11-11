import type { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { accountingCents, accountingTotalCents } from "../accounting.domain.js";
import { accrualAmounts, loadSchedule, scheduleAmounts, scheduleInclude } from "./schedule.repository.js";
import { latestAccrualActivity } from "./accrual.service.js";
import { dateText } from "./schedule.domain.js";
export async function stage23ReversalContext(tx: Prisma.TransactionClient, journalId: string) {
  const [draft, period, terminated, sourceSchedules, clearing] = await Promise.all([
    tx.accountingJournalDraft.findUnique({ where: { postedJournalId: journalId }, include: { lines: { orderBy: { lineNo: "asc" } } } }),
    tx.accountingSchedulePeriod.findUnique({ where: { recognitionJournalId: journalId } }),
    tx.accountingSchedule.findUnique({ where: { terminationJournalId: journalId } }),
    tx.accountingSchedule.findMany({ where: { relFkAccScheduleSource: { is: { journalId } } }, include: scheduleInclude, orderBy: { id: "asc" }, take: 241 }),
    tx.accountingDocument.findUnique({ where: { recognitionJournalId: journalId }, select: { accrualDraftId: true } })
  ]);
  const accrualId = draft?.sourceKind === "ACCRUAL_DOCUMENT" ? draft.id : draft?.parentAccrualDraftId ?? clearing?.accrualDraftId;
  const amounts = accrualId ? await accrualAmounts(tx, accrualId) : null;
  const latest = accrualId ? await latestAccrualActivity(tx, accrualId) : null;
  const activeAdjustments = accrualId ? await tx.accountingJournalDraft.count({ where: { parentAccrualDraftId: accrualId,
    postedJournal: { is: { revFkAccJournalReversal: { is: null } } } } }) : 0;
  return { draft, period, terminated, sourceSchedules, clearing, accrualId, amounts, latest, activeAdjustments };
}
export async function stage23ReversalDigest(tx: Prisma.TransactionClient, journalId: string) {
  const context = await stage23ReversalContext(tx, journalId);
  return { accrual: context.accrualId ?? null, amounts: context.amounts, latest: context.latest ? dateText(context.latest) : null,
    activeAdjustments: String(context.activeAdjustments), sourceSchedules: context.sourceSchedules.map(s => ({ id: s.id, status: s.status, ...scheduleAmounts(s) })),
    schedulePeriod: context.period?.id ?? null, termination: context.terminated?.id ?? null };
}
export async function validateStage23Reversal(tx: Prisma.TransactionClient, journalId: string, date: Date) {
  const context = await stage23ReversalContext(tx, journalId);
  if (context.latest && date < context.latest) throw new HttpError(409, "Accrual reversal cannot predate dependent posted activity.");
  if (context.draft?.sourceKind === "ACCRUAL_DOCUMENT" && (context.activeAdjustments || accountingTotalCents(context.amounts?.cleared ?? "0") !== 0n)) {
    throw new HttpError(409, "Resolve or reverse dependent accrual adjustments and AP/AR clearing before reversal.");
  }
  if (context.draft?.sourceKind === "ACCRUAL_ADJUSTMENT") {
    const json = context.draft.accrualMetadata;
    if (json && typeof json === "object" && !Array.isArray(json) && json.adjustmentKind === "INCREASE"
      && accountingTotalCents(context.amounts?.remaining ?? "0") < accountingCents(context.draft.lines[0]?.debit.plus(context.draft.lines[0].credit) ?? "0")) {
      throw new HttpError(409, "Adjustment reversal would over-clear the accrued balance.");
    }
  }
  if (context.sourceSchedules.length > 240) throw new HttpError(409, "Source has too many dependent schedules; review required.");
  for (const row of context.sourceSchedules) {
    const schedule = row, amounts = scheduleAmounts(schedule);
    if (schedule.status !== "CANCELLED" || amounts.recognized !== "0.00" || amounts.terminated !== "0.00") throw new HttpError(409, "Cancel and reverse dependent recognition schedules before reversing the source balance.");
  }
  if (context.period) {
    const schedule = await loadSchedule(tx, context.period.accountingScheduleId);
    const originalPeriod = context.period;
    if (schedule.terminationJournalId || schedule.revFkAccSchedulePeriodParent.some(p => p.recognitionJournalId
      && p.recognitionDate > originalPeriod.recognitionDate && !p.relFkAccSchedulePeriodJournal?.revFkAccJournalReversal)) {
      throw new HttpError(409, "Reverse later schedule recognitions or termination first.");
    }
  }
  return context;
}
export async function applyStage23Reversal(tx: Prisma.TransactionClient, journalId: string) {
  const context = await stage23ReversalContext(tx, journalId);
  const scheduleId = context.period?.accountingScheduleId ?? context.terminated?.id;
  if (scheduleId) await tx.accountingSchedule.update({ where: { id: scheduleId }, data: { status: "CANCELLED", revision: { increment: 1 },
    ...(context.terminated ? { terminationJournalId: null, terminatedOn: null } : {}) } });
}
