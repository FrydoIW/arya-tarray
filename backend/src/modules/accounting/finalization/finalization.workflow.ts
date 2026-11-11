import { integrityInTransaction } from "./financial-integrity.service.js";
import { HttpError } from "../../../lib/http.js";
import { submitApprovalInTransaction, applyApprovedAction } from "../approval/approval.service.js";
import { type ReportingPolicy, type ReportQuery, policySchema, reportQuerySchema } from "./finalization.schema.js";
import { manageAccounting, readAccounting, yearById, currentPolicy, newFinalDraft, finalDraft, periodById, day, dateText, material, digest, ledgerFingerprint } from "./finalization.repository.js";
import { prepareClosingInTransaction, integrityJournalChecks } from "./closing.service.js";
import { validateReportingPolicy, statementsInTransaction } from "./reporting.service.js";
import { allSubledgers } from "./reconciliation.service.js";
import { isFinalKind } from "./finalization-approval.service.js";
import { bankReviewControl } from "./bank-reconciliation.service.js";
export function createReportingPolicy(actor: string, fiscalYearId: string, policy: ReportingPolicy) { return manageAccounting(actor, async tx => {
  const year = await yearById(tx, fiscalYearId); if (year.status !== "OPEN") throw new HttpError(409, "Reporting policy adoption requires an OPEN year."); await validateReportingPolicy(tx, policy);
  const period = await tx.accountingPeriod.findFirst({ where: { fiscalYearId, status: "OPEN" }, orderBy: { startDate: "asc" } });
  return newFinalDraft(tx, actor, "REPORTING_POLICY", period?.startDate ?? year.endDate, policy, { fiscalYearId });
}); }
export function submitFinalSource(actor: string, id: string, revision: number) { return manageAccounting(actor, async tx => {
  const d = await finalDraft(tx, id); if (d.sourceKind !== "REPORTING_POLICY") throw new HttpError(409, "Use the typed close/bank/report workflow for this source.");
  return submitApprovalInTransaction(tx, actor, { kind: "REPORTING_POLICY", sourceDocumentId: id, expectedRevision: revision });
}); }
export function requestClosing(actor: string, type: "PERIOD" | "YEAR", id: string, reopen: boolean, reason: string, evidenceReference: string) { return manageAccounting(actor, async tx => {
  const d = await prepareClosingInTransaction(tx, actor, type, id, reopen, reason, evidenceReference);
  const kind = type === "PERIOD" ? reopen ? "PERIOD_REOPEN" : "PERIOD_CLOSE" : reopen ? "YEAR_REOPEN" : "YEAR_CLOSE";
  const approval = await submitApprovalInTransaction(tx, actor, { kind, sourceDocumentId: id, expectedRevision: d.sourceRevision, commandId: d.id });
  return { command: d, approval };
}); }
export function requestReportSnapshot(actor: string, q: ReportQuery) { return manageAccounting(actor, async tx => {
  const report = await statementsInTransaction(tx, q), periods = await tx.accountingPeriod.findMany({ where: { fiscalYearId: q.fiscalYearId, startDate: { lte: day(q.to) }, endDate: { gte: day(q.from) } }, orderBy: { startDate: "asc" } });
  if (report.status !== "DRAFT_VERIFIED" || !periods.length || periods.some(p => p.status !== "CLOSED")) throw new HttpError(409, "Verified reports and CLOSED scope periods are required for a final snapshot.");
  const d = await newFinalDraft(tx, actor, "REPORT_SNAPSHOT", day(q.to), { query: q, snapshot: report, periods }, { fiscalYearId: q.fiscalYearId });
  const approval = await submitApprovalInTransaction(tx, actor, { kind: "REPORT_SNAPSHOT", sourceDocumentId: d.id, expectedRevision: 1 }); return { snapshot: d, approval };
}); }
export function getReportSnapshot(actor: string, id: string) { return readAccounting(actor, async tx => {
  const d = await finalDraft(tx, id); if (d.sourceKind !== "REPORT_SNAPSHOT") throw new HttpError(404, "Report snapshot not found.");
  const parsed = reportQuerySchema.parse(d.finalizationMetadata && typeof d.finalizationMetadata === "object" && !Array.isArray(d.finalizationMetadata) ? d.finalizationMetadata.query : null);
  const current = await statementsInTransaction(tx, parsed), meta = d.finalizationMetadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta) || !meta.snapshot || typeof meta.snapshot !== "object" || Array.isArray(meta.snapshot)) throw new HttpError(409, "Stored report snapshot is invalid.");
  const periods = await tx.accountingPeriod.findMany({ where: { fiscalYearId: parsed.fiscalYearId, startDate: { lte: day(parsed.to) }, endDate: { gte: day(parsed.from) } }, orderBy: { startDate: "asc" } });
  const same = digest(periods) === digest(meta.periods) && current.ledgerFingerprint === meta.snapshot.ledgerFingerprint && String(current.fiscalYearRevision) === String(meta.snapshot.fiscalYearRevision) && current.policyId === meta.snapshot.policyId, integrity = await integrityInTransaction(tx, parsed);
  return { id, publicationStatus: d.status === "APPLIED" ? "FINAL_REVIEWED_SNAPSHOT" : d.status, currentStatus: !same ? "REVISED_SINCE_PUBLICATION" : integrity.status === "VERIFIED" ? "CURRENT" : "REVIEW_REQUIRED_SOURCE_EVIDENCE_CHANGED", immutableReport: meta.snapshot, currentReference: { fingerprint: current.ledgerFingerprint, fiscalYearRevision: current.fiscalYearRevision, integrity: integrity.status }, officialUseRequiresProfessionalReview: true };
}); }
export function finalSourceDetail(actor: string, id: string) { return readAccounting(actor, async tx => {
  const d = await finalDraft(tx, id), requests = await tx.accountingApprovalRequest.findMany({ where: { OR: [{ sourceDocumentId: id }, { requestPayload: { path: "$.commandId", equals: id } }] }, include: { history: { take: 100, orderBy: { actionAt: "asc" } } }, take: 100, orderBy: { requestedAt: "desc" } });
  return { ...d, requests, historyLimit: 100 };
}); }
export function applyFinalSource(actor: string, sourceId: string, approvalId: string) { return readAccounting(actor, async tx => {
  const request = await tx.accountingApprovalRequest.findUnique({ where: { id: approvalId } });
  if (!request || request.sourceDocumentId !== sourceId || !isFinalKind(request.requestKind)) throw new HttpError(409, "Matching typed finalization approval required."); return request.id;
}).then(id => applyApprovedAction(actor, id)); }
export { financialIntegrity } from "./financial-integrity.service.js";
export function supportingSchedules(actor: string, q: ReportQuery) { return readAccounting(actor, async tx => ({ scope: q, policy: (await currentPolicy(tx, q.fiscalYearId)).policy, subledgers: await allSubledgers(tx, q.fiscalYearId, q.to), report: await statementsInTransaction(tx, q), narrativeStatus: "REQUIRES_PROFESSIONAL_REVIEW_NOT_AUTOMATICALLY_APPROVED" })); }
export function openingPreparation(actor: string, fiscalYearId: string) { return readAccounting(actor, async tx => {
  const year = await yearById(tx, fiscalYearId), rows = await tx.accountingJournalLine.groupBy({ by: ["accountId", "accountingFundId", "fundRestrictionId", "eventCampaignId"], where: { journal: { accountingDate: { lte: year.endDate } }, account: { accountType: { in: ["ASSET", "LIABILITY", "NET_ASSET"] } } }, _sum: { debit: true, credit: true } });
  return { fiscalYearId, sourceYearStatus: year.status, targetStartDate: dateText(new Date(year.endDate.getTime() + 86400000)), rows, strategy: "CONTINUOUS_GL_CARRY_FORWARD_NO_DUPLICATE_OPENING_JOURNAL", postingAutomatic: false, ready: year.status === "CLOSED" };
}); }
