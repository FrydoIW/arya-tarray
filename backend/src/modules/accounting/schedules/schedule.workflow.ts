import { HttpError } from "../../../lib/http.js";
import { aparTransaction } from "../apar/apar.repository.js";
import { ACCOUNTING_MANAGE, ACCOUNTING_POST, appendApprovalHistory, loadApproval, requireAccountingPermission } from "../approval/approval.repository.js";
import { postApprovedJournalInTransaction, submitApproval } from "../approval/approval.service.js";
import { isStage23Kind, stage23Identity, applyNonfinancialScheduleApproval } from "./schedule-approval.service.js";
import { loadAccrual, loadSchedule, loadSchedulePeriod } from "./schedule.repository.js";
import type { ScheduleCommand } from "./schedule.schema.js";
export async function submitAccrual(actorId: string, id: string, expectedRevision: number) {
  const source = await aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
    const row = await tx.accountingJournalDraft.findUnique({ where: { id } });
    if (!row || !["ACCRUAL_DOCUMENT", "ACCRUAL_ADJUSTMENT"].includes(row.sourceKind)) throw new HttpError(404, "Accrual source was not found."); return row; });
  return submitApproval(actorId, { kind: source.sourceKind === "ACCRUAL_DOCUMENT" ? "ACCRUAL_DOCUMENT" : "ACCRUAL_ADJUSTMENT", sourceDocumentId: id, expectedRevision });
}
export function submitScheduleCommand(actorId: string, id: string, expectedRevision: number, command: ScheduleCommand) {
  const kind = command.action === "SETUP" ? "SCHEDULE_SETUP" : command.action === "CHANGE" ? "SCHEDULE_CHANGE" : command.action === "CANCEL" ? "SCHEDULE_CANCEL" : "SCHEDULE_TERMINATE";
  return submitApproval(actorId, { kind, sourceDocumentId: id, expectedRevision, command });
}
export function submitSchedulePeriod(actorId: string, id: string, expectedRevision: number, recognitionEvidence?: string) {
  return submitApproval(actorId, { kind: "SCHEDULE_PERIOD", sourceDocumentId: id, expectedRevision, recognitionEvidence });
}
export function applyStage23Source(actorId: string, id: string, approvalRequestId: string) {
  return aparTransaction(async tx => {
    await requireAccountingPermission(tx, actorId, ACCOUNTING_POST); const request = await loadApproval(tx, approvalRequestId);
    if (!isStage23Kind(request.requestKind) || request.sourceDocumentId !== id) throw new HttpError(409, "Approval does not belong to this source.");
    if (["SCHEDULE_SETUP", "SCHEDULE_CHANGE", "SCHEDULE_CANCEL"].includes(request.requestKind)) return applyNonfinancialScheduleApproval(tx, actorId, request.id);
    return postApprovedJournalInTransaction(tx, actorId, request.id);
  });
}
export function cancelAccrual(actorId: string, id: string, revision: number, reason: string) {
  return aparTransaction(async tx => {
    await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE); const row = await loadAccrual(tx, id);
    if (row.createdById !== actorId || row.status !== "DRAFT" || row.revision !== revision) throw new HttpError(409, "Only the creator can withdraw the current unposted accrual.");
    const identity = await stage23Identity(tx, { requestKind: "ACCRUAL_DOCUMENT", sourceDocumentId: id });
    let requests = await tx.accountingApprovalRequest.findMany({ where: { sourceDocumentId: id, status: { in: ["PENDING", "APPROVED"] } } });
    if (!requests.length) {
      const last = await tx.accountingApprovalRequest.aggregate({ where: { sourceDocumentId: id, requestKind: "ACCRUAL_DOCUMENT" }, _max: { sourceVersion: true } });
      requests = [await tx.accountingApprovalRequest.create({ data: { sourceDocumentId: id, journalDraftId: id, requestKind: "ACCRUAL_DOCUMENT",
        sourceVersion: Math.max(revision, (last._max.sourceVersion ?? 0) + 1), sourceDigest: identity.sourceDigest, requestedById: actorId,
        history: { create: { action: "SUBMIT", statusAfter: "PENDING", actorId, sourceDigest: identity.sourceDigest, remark: "Unposted withdrawal audit only; no approval granted." } } } })];
    }
    for (const request of requests) {
      await tx.accountingApprovalRequest.update({ where: { id: request.id }, data: { status: "CANCELLED" } });
      await appendApprovalHistory(tx, { approvalRequestId: request.id, actorId, action: "CANCEL", statusBefore: request.status, statusAfter: "CANCELLED", sourceDigest: request.sourceDigest, remark: reason });
    }
    return tx.accountingJournalDraft.update({ where: { id }, data: { status: "CANCELLED" } });
  });
}
export function getPeriod(actorId: string, id: string) { return aparTransaction(async tx => {
  await requireAccountingPermission(tx, actorId, "ACCOUNTING_REPORT"); return loadSchedulePeriod(tx, id);
}); }
export function schedulePeriodList(actorId: string, id: string) { return aparTransaction(async tx => {
  await requireAccountingPermission(tx, actorId, "ACCOUNTING_REPORT"); return (await loadSchedule(tx, id)).revFkAccSchedulePeriodParent;
}); }
export function dueReversals(actorId: string, asOf: string, page: number, pageSize: number) {
  return aparTransaction(async tx => {
    await requireAccountingPermission(tx, actorId, "ACCOUNTING_REPORT");
    const rows = await tx.$queryRaw<Array<{ id: string; scheduledDate: string }>>`
      SELECT d.journal_draft_id AS id,JSON_UNQUOTE(JSON_EXTRACT(d.accrual_metadata,'$.scheduledReversalOn')) AS scheduledDate
      FROM arya_accounting_journal_draft d JOIN arya_accounting_journal j ON j.accounting_journal_id=d.posted_journal_id
      WHERE d.source_kind='ACCRUAL_DOCUMENT' AND JSON_EXTRACT(d.accrual_metadata,'$.scheduledReversalOn')<>CAST('null' AS JSON)
        AND JSON_UNQUOTE(JSON_EXTRACT(d.accrual_metadata,'$.scheduledReversalOn'))<=${asOf}
        AND NOT EXISTS (SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id)
      ORDER BY scheduledDate,id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    return { asOf, page, pageSize, rows, postingAutomatic: false };
  });
}
