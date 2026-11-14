import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { accountingApprovalDigest, assertAccountingApprovalForPosting } from "../approval/approval.domain.js";
import { ACCOUNTING_APPROVE, ACCOUNTING_POST, appendApprovalHistory, approvalEvidence, hasAccountingPermission, loadApproval } from "../approval/approval.repository.js";
import { loadDraft } from "../approval/approval-source.repository.js";
import { invalidateRequests } from "../approval/approval.service.js";
import { validateAccrualDraft } from "./accrual.service.js";
import { loadSchedule, loadSchedulePeriod, scheduleAmounts, replaceUnpostedPeriods } from "./schedule.repository.js";
import { validateScheduleCommand, validateSchedulePeriod } from "./schedule.service.js";
import { scheduleCommandSchema } from "./schedule.schema.js";
import { day, dateText } from "./schedule.domain.js";
import type { LedgerJournalInput } from "../ledger/ledger.service.js";
import { z } from "zod";
export const isAccrualKind = (kind: string) => ["ACCRUAL_DOCUMENT", "ACCRUAL_ADJUSTMENT"].includes(kind);
export const isScheduleKind = (kind: string) => ["SCHEDULE_SETUP", "SCHEDULE_CHANGE", "SCHEDULE_CANCEL", "SCHEDULE_TERMINATE", "SCHEDULE_PERIOD"].includes(kind);
export const isStage23Kind = (kind: string) => isAccrualKind(kind) || isScheduleKind(kind);
type RequestSource = { id?: string; requestKind: string; sourceDocumentId: string; requestPayload?: unknown };
export const commandPayload = (payload: unknown) => z.object({ command: scheduleCommandSchema }).passthrough().parse(payload).command;
function earliestUnposted(schedule: Awaited<ReturnType<typeof loadSchedule>>) {
  return schedule.revFkAccSchedulePeriodParent.filter(period => !period.recognitionJournalId)
    .sort((left, right) => left.recognitionDate.getTime() - right.recognitionDate.getTime())[0]?.recognitionDate;
}
function header(schedule: Awaited<ReturnType<typeof loadSchedule>>) {
  return { id: schedule.id, revision: String(schedule.revision), status: schedule.status, kind: schedule.scheduleKind,
    sourceLine: schedule.sourceJournalLineId, document: schedule.accountingDocumentId, recognition: schedule.recognitionAccountId,
    balance: schedule.balanceAccountId, amount: schedule.plannedAmount.toFixed(2), method: schedule.allocationMethod,
    start: dateText(schedule.startDate), end: dateText(schedule.endDate), policy: schedule.policyEvidence,
    basis: schedule.recognitionBasis, creator: schedule.createdById };
}
export async function stage23Identity(tx: Prisma.TransactionClient, request: RequestSource) {
  if (isAccrualKind(request.requestKind)) {
    const draft = await loadDraft(tx, request.sourceDocumentId);
    if (draft.sourceKind !== request.requestKind) throw new HttpError(409, "Accrual approval source kind mismatch.");
    const material = { id: draft.id, revision: String(draft.revision), journalType: draft.journalType,
      sourceKind: draft.sourceKind, sourceReference: draft.sourceReference, accountingDate: dateText(draft.accountingDate),
      description: draft.description, metadata: draft.accrualMetadata, parentAccrualDraftId: draft.parentAccrualDraftId,
      createdById: draft.createdById, lines: draft.lines.map(line => ({ lineNo: String(line.lineNo), accountId: line.accountId,
        debit: line.debit.toFixed(2), credit: line.credit.toFixed(2), counterpartyId: line.counterpartyId })) };
    return { material, sourceDigest: accountingApprovalDigest(material), sourceVersion: draft.revision,
      requesterId: draft.createdById, accountingDate: draft.accountingDate, sourceLink: { journalDraftId: draft.id } };
  }
  const data = request.requestKind === "SCHEDULE_PERIOD" ? await loadSchedulePeriod(tx, request.sourceDocumentId) : null;
  const schedule = data?.schedule ?? await loadSchedule(tx, request.sourceDocumentId);
  const rows = data ? [data.row] : schedule.revFkAccSchedulePeriodParent;
  const command = data ? null : commandPayload(request.requestPayload);
  const evidence = data ? z.object({ recognitionEvidence: z.string().trim().min(10).max(1000).optional() }).passthrough().parse(request.requestPayload ?? {}).recognitionEvidence : undefined;
  if (data && schedule.scheduleKind === "DEFERRED_INCOME" && !evidence) throw new HttpError(409, "Deferred income period requires explicit evidence that the underlying performance obligation is fulfilled.");
  if (command && `SCHEDULE_${command.action}` !== request.requestKind) throw new HttpError(409, "Schedule action does not match its approval kind.");
  const material = { header: header(schedule), command, recognitionEvidence: evidence ?? null, periods: rows.map(p => ({ id: p.id,
    accountingPeriodId: p.accountingPeriodId, date: dateText(p.recognitionDate), amount: p.plannedAmount.toFixed(2), journal: p.recognitionJournalId })) };
  const prospectiveDate = command?.action === "SETUP" ? schedule.startDate : earliestUnposted(schedule) ?? schedule.startDate;
  return { material, sourceDigest: accountingApprovalDigest(material), sourceVersion: schedule.revision,
    requesterId: schedule.createdById, accountingDate: data?.row.recognitionDate
      ?? (command?.action === "TERMINATE" ? day(command.accountingDate) : prospectiveDate),
    sourceLink: data ? { accountingSchedulePeriodId: data.row.id } : { accountingScheduleId: schedule.id } };
}
export async function validateStage23Request(tx: Prisma.TransactionClient, request: RequestSource) {
  if (isAccrualKind(request.requestKind)) return validateAccrualDraft(tx, request.sourceDocumentId);
  if (request.requestKind === "SCHEDULE_PERIOD") return validateSchedulePeriod(tx, request.sourceDocumentId);
  return validateScheduleCommand(tx, request.sourceDocumentId, commandPayload(request.requestPayload));
}
export type SchedulePostingPlan = { expected: LedgerJournalInput; draftId?: string; periodId?: string; scheduleId?: string; terminate?: boolean };
export async function prepareStage23Posting(tx: Prisma.TransactionClient, request: RequestSource, postedById: string): Promise<SchedulePostingPlan> {
  if (isAccrualKind(request.requestKind)) {
    const draft = await validateAccrualDraft(tx, request.sourceDocumentId);
    const parent = draft.parentAccrualDraftId ? await loadDraft(tx, draft.parentAccrualDraftId) : null;
    return { draftId: draft.id, expected: { approvalRequestId: request.id,
      journalType: request.requestKind === "ACCRUAL_DOCUMENT" ? "ACCRUAL" : "ADJUSTMENT", sourceKind: draft.sourceKind,
      sourceReference: draft.sourceReference, accountingDate: draft.accountingDate, postedById, descriptionSnapshot: draft.description,
      relatedJournalId: parent?.postedJournalId ?? null, lines: draft.lines.map(line => ({ accountId: line.accountId,
        debit: line.debit.toFixed(2), credit: line.credit.toFixed(2), counterpartyId: line.counterpartyId })) } };
  }
  const terminate = request.requestKind === "SCHEDULE_TERMINATE";
  if (!terminate && request.requestKind !== "SCHEDULE_PERIOD") throw new HttpError(409, "This approved schedule action does not create a journal.");
  const data = terminate ? null : await validateSchedulePeriod(tx, request.sourceDocumentId);
  const command = terminate ? commandPayload(request.requestPayload) : null;
  const schedule = data?.schedule ?? await validateScheduleCommand(tx, request.sourceDocumentId, commandPayload(request.requestPayload));
  if (command && command.action !== "TERMINATE") throw new HttpError(409, "Termination payload mismatch.");
  const amount = data?.row.plannedAmount.toFixed(2) ?? scheduleAmounts(schedule).remaining;
  const prepaid = schedule.scheduleKind === "PREPAYMENT", source = schedule.relFkAccScheduleSource;
  const dimensions = { counterpartyId: source.counterpartyId, accountingFundId: source.accountingFundId,
    fundRestrictionId: source.fundRestrictionId, eventCampaignId: source.eventCampaignId };
  return { scheduleId: schedule.id, periodId: data?.row.id, terminate, expected: {
    approvalRequestId: request.id, journalType: "ADJUSTMENT", sourceKind: terminate ? "SCHEDULE_TERMINATION" : "SCHEDULE_RECOGNITION",
    sourceReference: data?.row.id ?? request.id ?? schedule.id, accountingDate: data?.row.recognitionDate ?? day(command && command.action === "TERMINATE" ? command.accountingDate : ""),
    postedById, descriptionSnapshot: command && command.action === "TERMINATE" ? command.reason : schedule.recognitionBasis,
    relatedJournalId: source.journalId,
    lines: [{ accountId: prepaid ? schedule.recognitionAccountId : schedule.balanceAccountId, debit: amount, credit: "0.00", ...dimensions },
      { accountId: prepaid ? schedule.balanceAccountId : schedule.recognitionAccountId, debit: "0.00", credit: amount, ...dimensions }] } };
}
export async function applyStage23Posting(tx: Prisma.TransactionClient, plan: SchedulePostingPlan, journalId: string) {
  if (plan.periodId && plan.scheduleId) {
    const changed = await tx.accountingSchedulePeriod.updateMany({ where: { id: plan.periodId, recognitionJournalId: null }, data: { recognitionJournalId: journalId } });
    if (changed.count !== 1) throw new HttpError(409, "Schedule period was already posted.");
    if (!await tx.accountingSchedulePeriod.count({ where: { accountingScheduleId: plan.scheduleId, recognitionJournalId: null } })) {
      await tx.accountingSchedule.update({ where: { id: plan.scheduleId }, data: { status: "COMPLETED" } });
    }
  }
  if (plan.terminate && plan.scheduleId) await tx.accountingSchedule.update({ where: { id: plan.scheduleId },
    data: { status: "TERMINATED", terminationJournalId: journalId, terminatedOn: plan.expected.accountingDate } });
}
export async function applyNonfinancialScheduleApproval(tx: Prisma.TransactionClient, actorId: string, id: string) {
  const request = await loadApproval(tx, id), identity = await stage23Identity(tx, request);
  const evidence = approvalEvidence(request);
  assertAccountingApprovalForPosting({ request: evidence, kind: evidence.kind, sourceDocumentId: request.sourceDocumentId,
    sourceVersion: identity.sourceVersion, currentDigest: identity.sourceDigest, hasPostingPermission: await hasAccountingPermission(tx, actorId, ACCOUNTING_POST) });
  if (!request.decidedById || !await hasAccountingPermission(tx, request.decidedById, ACCOUNTING_APPROVE)) throw new HttpError(409, "Approver is no longer authorized.");
  const command = commandPayload(request.requestPayload), schedule = await validateScheduleCommand(tx, request.sourceDocumentId, command);
  if (command.action === "TERMINATE") throw new HttpError(409, "Financial termination must use the common journal engine.");
  const now = new Date(), changed = await tx.accountingApprovalRequest.updateMany({ where: { id, status: "APPROVED", sourceDigest: request.sourceDigest },
    data: { status: "APPLIED", appliedById: actorId, appliedAt: now } });
  if (changed.count !== 1) throw new HttpError(409, "Schedule approval already applied or stale.");
  if (command.action === "CHANGE") {
    await replaceUnpostedPeriods(tx, schedule.id, command.periods);
  }
  await tx.accountingSchedule.update({ where: { id: schedule.id }, data: command.action === "SETUP" ? { status: "ACTIVE" }
    : { status: command.action === "CANCEL" ? "CANCELLED" : schedule.status, allocationMethod: command.action === "CHANGE" ? "CUSTOM" : schedule.allocationMethod, revision: { increment: 1 } } });
  if (command.action !== "SETUP") {
    await invalidateRequests(tx, [schedule.id, ...schedule.revFkAccSchedulePeriodParent.map(p => p.id)], actorId);
  }
  await appendApprovalHistory(tx, { approvalRequestId: id, actorId, action: "APPLY", statusBefore: "APPROVED", statusAfter: "APPLIED", sourceDigest: request.sourceDigest, actionAt: now });
  return { approvalRequestId: id, scheduleId: schedule.id, action: command.action, financialJournalCreated: false };
}
