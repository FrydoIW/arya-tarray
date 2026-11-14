import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { accountingCents, accountingCutoverDate } from "../accounting.domain.js";
import { aparTransaction } from "../apar/apar.repository.js";
import { ACCOUNTING_MANAGE, requireAccountingPermission } from "../approval/approval.repository.js";
import { generateSchedulePlan, day, dateText, validatePlanRows } from "./schedule.domain.js";
import { loadSchedule, loadSchedulePeriod, scheduleAmounts, scheduleLedgerRemaining, sourceCapacity } from "./schedule.repository.js";
import { requireAccounts } from "./accrual.service.js";
import type { PlanInput, ScheduleInput, ScheduleCommand } from "./schedule.schema.js";

export function configuredPeriods(tx: Prisma.TransactionClient, start: string, end: string) {
  return tx.accountingPeriod.findMany({ where: { startDate: { lte: day(end) }, endDate: { gte: day(start) } }, orderBy: { startDate: "asc" }, take: 241 });
}
async function requireOpenSchedulePeriods(tx: Prisma.TransactionClient, periodIds: string[]) {
  const ids = [...new Set(periodIds)];
  if (!ids.length) throw new HttpError(409, "Schedule command requires at least one unposted accounting period.");
  const periods = await tx.accountingPeriod.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, relFkAccPeriodFy: { select: { status: true } } } });
  if (periods.length !== ids.length || periods.some(period => period.status !== "OPEN" || period.relFkAccPeriodFy.status !== "OPEN")) {
    throw new HttpError(409, "Every affected accounting period and fiscal year must be OPEN.");
  }
}
export function previewSchedule(actorId: string, input: PlanInput) {
  return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
    if (day(input.startDate) < accountingCutoverDate()) throw new HttpError(409, "Schedule cannot predate Accounting cutover.");
    return { ...input, periods: generateSchedulePlan(input, await configuredPeriods(tx, input.startDate, input.endDate)), postingAutomatic: false };
  });
}
export async function validateScheduleSource(tx: Prisma.TransactionClient, schedule: { id?: string; sourceJournalLineId: string;
  scheduleKind: string; recognitionAccountId: string; balanceAccountId: string; plannedAmount: Prisma.Decimal | string; startDate: Date }) {
  const { source, allocated } = await sourceCapacity(tx, schedule.sourceJournalLineId, schedule.id);
  const prepaid = schedule.scheduleKind === "PREPAYMENT";
  await requireAccounts(tx, [[schedule.balanceAccountId, prepaid ? "ASSET" : "LIABILITY"], [schedule.recognitionAccountId, prepaid ? "EXPENSE" : "REVENUE"]]);
  const original = prepaid ? source.debit : source.credit;
  if (source.accountId !== schedule.balanceAccountId || accountingCents(original) <= 0n
    || accountingCents(schedule.plannedAmount) + accountingCents(allocated) > accountingCents(original)) {
    throw new HttpError(409, "Schedule amount exceeds the unallocated actual posted prepaid/deferred balance.");
  }
  return source;
}
export function createSchedule(actorId: string, input: ScheduleInput) {
  return aparTransaction(async tx => {
    await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
    if (day(input.startDate) < accountingCutoverDate()) throw new HttpError(409, "Schedule cannot predate cutover.");
    const periods = generateSchedulePlan(input, await configuredPeriods(tx, input.startDate, input.endDate));
    const { source, latest } = await sourceCapacity(tx, input.sourceJournalLineId);
    const candidate = { sourceJournalLineId: source.id, scheduleKind: input.scheduleKind, recognitionAccountId: input.recognitionAccountId,
      balanceAccountId: source.accountId, plannedAmount: input.amount, startDate: day(input.startDate) };
    await validateScheduleSource(tx, candidate);
    if (periods.some(p => day(p.recognitionDate) < latest)) throw new HttpError(409, "Recognition cannot predate its posted balance source activity.");
    const document = await tx.accountingDocument.findUnique({ where: { recognitionJournalId: source.journalId }, select: { id: true } });
    const schedule = await tx.accountingSchedule.create({ data: { ...candidate, scheduleReference: input.scheduleReference,
      endDate: day(input.endDate), allocationMethod: input.allocationMethod, policyEvidence: input.policyEvidence,
      recognitionBasis: input.recognitionBasis, accountingDocumentId: document?.id ?? null, createdById: actorId, status: "DRAFT",
      revFkAccSchedulePeriodParent: { create: periods.map(row => ({ accountingPeriodId: row.accountingPeriodId,
        recognitionDate: day(row.recognitionDate), plannedAmount: row.plannedAmount })) } } });
    return loadSchedule(tx, schedule.id);
  });
}
export async function validateScheduleCommand(tx: Prisma.TransactionClient, id: string, command: ScheduleCommand) {
  const schedule = await loadSchedule(tx, id), periods = schedule.revFkAccSchedulePeriodParent;
  if (command.action === "SETUP") {
    if (schedule.status !== "DRAFT") throw new HttpError(409, "Only a pending-review schedule can be activated.");
    await validateScheduleSource(tx, schedule);
    validatePlanRows(periods.map(p => ({ accountingPeriodId: p.accountingPeriodId, recognitionDate: dateText(p.recognitionDate), plannedAmount: p.plannedAmount.toFixed(2) })),
      schedule.plannedAmount.toFixed(2), dateText(schedule.startDate), dateText(schedule.endDate), await configuredPeriods(tx, dateText(schedule.startDate), dateText(schedule.endDate)));
  } else if (!["DRAFT", "ACTIVE"].includes(schedule.status)) throw new HttpError(409, "Schedule is no longer adjustable or cancellable.");
  if (command.action === "CHANGE") {
    const pending = periods.filter(p => !p.recognitionJournalId);
    const byId = new Set(pending.map(p => p.accountingPeriodId));
    if (command.periods.length !== pending.length || command.periods.some(p => !byId.has(p.accountingPeriodId))) {
      throw new HttpError(409, "Revise exactly the existing unposted periods; posted period evidence is immutable.");
    }
    validatePlanRows(command.periods, scheduleAmounts(schedule).remaining, dateText(schedule.startDate), dateText(schedule.endDate),
      await configuredPeriods(tx, dateText(schedule.startDate), dateText(schedule.endDate)));
    const last = periods.filter(p => p.recognitionJournalId).at(-1)?.recognitionDate ?? schedule.relFkAccScheduleSource.journal.accountingDate;
    if (command.periods.some(p => day(p.recognitionDate) < last)) throw new HttpError(409, "Revised recognition cannot predate posted activity.");
    await requireOpenSchedulePeriods(tx, command.periods.map(p => p.accountingPeriodId));
  }
  if (command.action === "CANCEL") {
    await requireOpenSchedulePeriods(tx, periods.filter(p => !p.recognitionJournalId).map(p => p.accountingPeriodId));
  }
  if (command.action === "TERMINATE") {
    if (schedule.status !== "ACTIVE" || accountingCents(scheduleAmounts(schedule).remaining) <= 0n) throw new HttpError(409, "Only an active remaining balance can be terminated.");
    const latest = periods.filter(p => p.recognitionJournalId).at(-1)?.recognitionDate ?? schedule.relFkAccScheduleSource.journal.accountingDate;
    if (day(command.accountingDate) < latest) throw new HttpError(409, "Termination cannot predate posted source or recognition.");
    await validateScheduleSource(tx, schedule);
  }
  return schedule;
}
export async function validateSchedulePeriod(tx: Prisma.TransactionClient, id: string) {
  const { row, schedule } = await loadSchedulePeriod(tx, id);
  if (schedule.status !== "ACTIVE" || row.recognitionJournalId) throw new HttpError(409, "Only an active unposted schedule period may be recognized.");
  if (schedule.revFkAccSchedulePeriodParent.reduce((total, p) => total + accountingCents(p.plannedAmount), 0n) !== accountingCents(schedule.plannedAmount)) throw new HttpError(409, "Schedule period totals no longer match the original amount.");
  if (accountingCents(row.plannedAmount) > accountingCents(scheduleAmounts(schedule).remaining)) throw new HttpError(409, "Recognition exceeds the remaining schedule balance.");
  const previous = schedule.revFkAccSchedulePeriodParent.filter(p => p.recognitionDate < row.recognitionDate);
  if (previous.some(p => !p.recognitionJournalId)) throw new HttpError(409, "Post earlier schedule periods first.");
  await validateScheduleSource(tx, schedule);
  const { latest } = await sourceCapacity(tx, schedule.sourceJournalLineId, schedule.id);
  if (row.recognitionDate < latest) throw new HttpError(409, "Recognition cannot predate existing posted source activity.");
  return { row, schedule };
}
export function getSchedule(actorId: string, id: string) {
  return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, "ACCOUNTING_REPORT");
    const schedule = await loadSchedule(tx, id);
    const ledgerRemaining = await scheduleLedgerRemaining(tx, schedule);
    const approvals = await tx.accountingApprovalRequest.findMany({ where: { OR: [{ accountingScheduleId: id },
      { schedulePeriod: { is: { accountingScheduleId: id } } }] }, include: { history: true }, orderBy: { requestedAt: "asc" }, take: 500 });
    return { ...schedule, ...scheduleAmounts(schedule), controlReconciliation: { generalLedgerRemaining: ledgerRemaining,
      reconciled: ledgerRemaining === scheduleAmounts(schedule).remaining }, approvalHistory: approvals, approvalHistoryLimit: 500,
      policyStatus: approvals.some(r => r.requestKind === "SCHEDULE_SETUP" && r.status === "APPLIED") ? "REVIEWED" : "PENDING_INDEPENDENT_REVIEW", postingAutomatic: false };
  });
}
export function listStage23(actorId: string, type: "ACCRUAL" | "SCHEDULE", page: number, pageSize: number) {
  return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, "ACCOUNTING_REPORT");
    if (type === "ACCRUAL") {
      const where = { sourceKind: "ACCRUAL_DOCUMENT" };
      const [total, rows] = await Promise.all([tx.accountingJournalDraft.count({ where }), tx.accountingJournalDraft.findMany({ where,
        take: pageSize, skip: (page - 1) * pageSize, orderBy: [{ accountingDate: "desc" }, { id: "desc" }] })]);
      return { page, pageSize, total, rows };
    }
    const [total, rows] = await Promise.all([tx.accountingSchedule.count(), tx.accountingSchedule.findMany({ take: pageSize,
      skip: (page - 1) * pageSize, orderBy: [{ startDate: "desc" }, { id: "desc" }] })]);
    return { page, pageSize, total, rows };
  });
}
