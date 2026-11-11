import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { assertAccountingApprovalForPosting } from "../approval/approval.domain.js";
import { ACCOUNTING_APPROVE, ACCOUNTING_POST, approvalEvidence, appendApprovalHistory, hasAccountingPermission, loadApproval } from "../approval/approval.repository.js";
import type { LedgerJournalInput } from "../ledger/ledger.service.js";
import { policySchema, reportQuerySchema } from "./finalization.schema.js";
import { closePreview } from "./closing.service.js";
import { bankPreview, bankReconById } from "./bank-reconciliation.service.js";
import { currentPolicy, periodById, yearById, finalDraft, material, digest, cents, money, ledgerFingerprint } from "./finalization.repository.js";
import { statementsInTransaction, validateReportingPolicy, netAssetClass } from "./reporting.service.js";
import type { PostedJournalInput } from "../ledger/posted-journal.service.js";
import { integrityInTransaction } from "./financial-integrity.service.js";
export const isFinalKind = (k: string) => ["REPORTING_POLICY", "REPORT_SNAPSHOT", "BANK_RECONCILIATION", "PERIOD_CLOSE", "PERIOD_REOPEN", "YEAR_CLOSE", "YEAR_REOPEN"].includes(k);
type Request = { id?: string; requestKind: string; sourceDocumentId: string; requestPayload?: unknown };
type Meta = { reason?: string; evidenceReference?: string; previousClosingDraftId?: string | null; snapshot?: { priorClosingDraftId?: string | null }; query?: unknown };
function meta(value: unknown): Meta { if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(409, "Finalization metadata is invalid."); return value; }
function commandId(r: Request) { const payload = meta(r.requestPayload); if (!("commandId" in payload) || typeof payload.commandId !== "string") throw new HttpError(409, "Typed closing command reference required."); return payload.commandId; }
export async function finalSourceView(tx: Prisma.TransactionClient, r: Request) {
  const current = r.requestKind === "BANK_RECONCILIATION" ? await bankReconById(tx, r.sourceDocumentId) : r.requestKind.startsWith("PERIOD_") ? await periodById(tx, r.sourceDocumentId) : r.requestKind.startsWith("YEAR_") ? await yearById(tx, r.sourceDocumentId) : await finalDraft(tx, r.sourceDocumentId);
  return { current, reviewedPayload: r.requestPayload ?? null };
}
export async function requireAnnualPostingPeriod(tx: Prisma.TransactionClient, input: PostedJournalInput) {
  if (!input.approvalRequestId) throw new HttpError(409, "Annual closing requires persisted fiscal approval."); const request = await loadApproval(tx, input.approvalRequestId);
  if (request.requestKind !== input.sourceKind || !request.fiscalYearId) throw new HttpError(409, "Annual posting approval/source mismatch.");
  const year = await yearById(tx, request.fiscalYearId), periods = await tx.accountingPeriod.findMany({ where: { fiscalYearId: year.id, endDate: year.endDate }, take: 2 });
  if (input.accountingDate.getTime() !== year.endDate.getTime() || periods.length !== 1 || periods[0]?.status !== "CLOSED" || year.status !== (request.requestKind === "YEAR_CLOSE" ? "CLOSING" : "CLOSED")) throw new HttpError(409, "Annual posting needs its frozen fiscal year and CLOSED final period.");
  return periods[0].id;
}
export async function finalIdentity(tx: Prisma.TransactionClient, r: Request) {
  const kind = r.requestKind, id = r.sourceDocumentId;
  if (kind === "BANK_RECONCILIATION") {
    const root = await bankReconById(tx, id), preview = await bankPreview(tx, id), p = meta(r.requestPayload ?? {}), value = material({ root, preview, bankAction: "bankAction" in p ? p.bankAction : "CLOSE", reason: p.reason ?? null, evidenceReference: p.evidenceReference ?? null });
    return { material: value, sourceDigest: digest(value), sourceVersion: root.revision, requesterId: root.createdById, accountingDate: root.reconciliationDate, sourceLink: { bankReconciliationId: id } };
  }
  if (["REPORTING_POLICY", "REPORT_SNAPSHOT"].includes(kind)) {
    const d = await finalDraft(tx, id); if (d.sourceKind !== kind || !d.fiscalYearId) throw new HttpError(409, "Finalization kind/reference mismatch.");
    const year = await yearById(tx, d.fiscalYearId), query = kind === "REPORT_SNAPSHOT" ? reportQuerySchema.parse(meta(d.finalizationMetadata).query) : null;
    const current = query ? await statementsInTransaction(tx, query) : null;
    const periods = query ? await tx.accountingPeriod.findMany({ where: { fiscalYearId: year.id, startDate: { lte: new Date(query.to) }, endDate: { gte: new Date(query.from) } }, orderBy: { startDate: "asc" } }) : null;
    const value = material({ draft: d, year, current, periods }); return { material: value, sourceDigest: digest(value), sourceVersion: d.revision, requesterId: d.createdById, accountingDate: d.accountingDate, sourceLink: { journalDraftId: id } };
  }
  const d = await finalDraft(tx, commandId(r)), period = kind.startsWith("PERIOD_") ? await periodById(tx, id) : null, year = await yearById(tx, period?.fiscalYearId ?? id), root = period ?? year;
  if (d.sourceKind !== kind || root.closingDraftId !== d.id || d.fiscalYearId !== year.id || period && d.accountingPeriodId !== period.id) throw new HttpError(409, "Closing command no longer matches its typed fiscal/period source.");
  const current = kind.endsWith("CLOSE") ? await closePreview(tx, period ? "PERIOD" : "YEAR", id) : { fingerprint: await ledgerFingerprint(tx, year.startDate, root.endDate), yearRevision: String(year.revision), laterActivity: String(await tx.accountingJournal.count({ where: { accountingDate: { gt: year.endDate } } })) };
  const value = material({ root, command: d, current }); return { material: value, sourceDigest: digest(value), sourceVersion: root.revision, requesterId: d.createdById, accountingDate: root.endDate, sourceLink: period ? { accountingPeriodId: id } : { fiscalYearId: id } };
}
export async function validateFinalRequest(tx: Prisma.TransactionClient, r: Request) {
  const kind = r.requestKind;
  if (kind === "BANK_RECONCILIATION") {
    const root = await bankReconById(tx, r.sourceDocumentId), p = meta(r.requestPayload ?? {}), reopening = "bankAction" in p && p.bankAction === "REOPEN";
    if (reopening) { if (!["CLOSED", "REVIEW"].includes(root.status) || (await periodById(tx, root.accountingPeriodId)).status !== "OPEN" || !p.reason || !p.evidenceReference) throw new HttpError(409, "Bank reopening needs an OPEN accounting period, prior sign-off and independent reason/evidence."); }
    else if (!["OPEN", "REVIEW"].includes(root.status) || (await bankPreview(tx, root.id)).status !== "VERIFIED") throw new HttpError(409, "Bank reconciliation has unresolved differences or source state."); return;
  }
  if (kind === "REPORTING_POLICY") { const d = await finalDraft(tx, r.sourceDocumentId); if (d.status !== "DRAFT" || !d.fiscalYearId || (await yearById(tx, d.fiscalYearId)).status !== "OPEN") throw new HttpError(409, "Policy adoption requires a current draft in an OPEN year."); await validateReportingPolicy(tx, policySchema.parse(d.finalizationMetadata)); return; }
  if (kind === "REPORT_SNAPSHOT") {
    const d = await finalDraft(tx, r.sourceDocumentId), query = reportQuerySchema.parse(meta(d.finalizationMetadata).query), report = await statementsInTransaction(tx, query);
    const periods = await tx.accountingPeriod.findMany({ where: { fiscalYearId: query.fiscalYearId, startDate: { lte: new Date(query.to) }, endDate: { gte: new Date(query.from) } } });
    if (d.status !== "DRAFT" || report.status !== "DRAFT_VERIFIED" || !periods.length || periods.some(p => p.status !== "CLOSED") || (await integrityInTransaction(tx, query)).status !== "VERIFIED") throw new HttpError(409, "Final report snapshot requires verified integrity, source reconciliations, mappings/equations and CLOSED scope periods."); return;
  }
  const d = await finalDraft(tx, commandId(r)), period = kind.startsWith("PERIOD_") ? await periodById(tx, r.sourceDocumentId) : null, year = await yearById(tx, period?.fiscalYearId ?? r.sourceDocumentId), root = period ?? year;
  if (d.status !== "DRAFT" || root.closingDraftId !== d.id || root.status !== (kind.endsWith("REOPEN") ? "CLOSED" : "CLOSING") || period && year.status !== "OPEN") throw new HttpError(409, "Closing/reopening source state changed.");
  if (kind.endsWith("CLOSE") && (await closePreview(tx, period ? "PERIOD" : "YEAR", root.id)).status !== "READY") throw new HttpError(409, "Closing checklist changed or is not ready.");
  if (kind === "YEAR_REOPEN" && await tx.accountingJournal.count({ where: { accountingDate: { gt: year.endDate } } })) throw new HttpError(409, "Later-year financial activity prevents reopening without dependency review.");
}
export async function prepareFinalSubmission(tx: Prisma.TransactionClient, r: Request) {
  await validateFinalRequest(tx, r);
  if (r.requestKind === "BANK_RECONCILIATION") {
    const p = meta(r.requestPayload ?? {}), changed = await tx.accountingBankReconciliation.updateMany({ where: { id: r.sourceDocumentId, status: "bankAction" in p && p.bankAction === "REOPEN" ? "CLOSED" : "OPEN" }, data: { status: "REVIEW" } });
    if (changed.count !== 1) throw new HttpError(409, "Bank reconciliation is already frozen for review.");
  }
}
export type FinalPostingPlan = { expected: LedgerJournalInput; commandId: string; fiscalYearId: string; reopening: boolean };
export async function prepareFinalPosting(tx: Prisma.TransactionClient, r: Request, actor: string): Promise<FinalPostingPlan | null> {
  if (!["YEAR_CLOSE", "YEAR_REOPEN"].includes(r.requestKind)) return null;
  await validateFinalRequest(tx, r); const d = await finalDraft(tx, commandId(r)), year = await yearById(tx, r.sourceDocumentId), base = { approvalRequestId: r.id, postedById: actor, accountingDate: year.endDate };
  if (r.requestKind === "YEAR_REOPEN") {
    const previous = meta(d.finalizationMetadata).snapshot?.priorClosingDraftId;
    const prior = previous ? await finalDraft(tx, previous) : null;
    if (!prior?.postedJournalId) return null;
    const journal = await tx.accountingJournal.findUnique({ where: { id: prior.postedJournalId }, include: { lines: { orderBy: { lineNo: "asc" } }, revFkAccJournalReversal: true } });
    if (!journal || journal.sourceKind !== "YEAR_CLOSE" || journal.revFkAccJournalReversal) throw new HttpError(409, "Annual closing journal already reversed or unavailable.");
    return { commandId: d.id, fiscalYearId: year.id, reopening: true, expected: { ...base, journalType: "REVERSAL", sourceKind: "YEAR_REOPEN", sourceReference: d.id, relatedJournalId: journal.id, reversalOfJournalId: journal.id, descriptionSnapshot: "Independently approved annual reopening",
      lines: journal.lines.map(l => ({ accountId: l.accountId, debit: l.credit.toFixed(2), credit: l.debit.toFixed(2), accountingFundId: l.accountingFundId, fundRestrictionId: l.fundRestrictionId, eventCampaignId: l.eventCampaignId })) } };
  }
  const config = await currentPolicy(tx, year.id); if (!config.policy?.annual) throw new HttpError(409, "PENDING_POLICY: explicit annual net-asset closing mapping required.");
  const groups = await tx.$queryRaw<{ accountId: string; fundId: string | null; restrictionId: string | null; campaignId: string | null; fundClass: string | null; net: Prisma.Decimal }[]>`SELECT l.accounting_account_id AS accountId,l.accounting_fund_id AS fundId,l.fund_restriction_id AS restrictionId,l.event_campaign_id AS campaignId,f.fund_class AS fundClass,SUM(l.debit-l.credit) AS net FROM arya_accounting_journal_line l JOIN arya_accounting_journal j USING(accounting_journal_id) JOIN arya_accounting_account a USING(accounting_account_id) LEFT JOIN arya_accounting_fund f ON f.accounting_fund_id=l.accounting_fund_id WHERE j.accounting_date<=${year.endDate} AND a.account_type IN ('REVENUE','EXPENSE') GROUP BY l.accounting_account_id,l.accounting_fund_id,l.fund_restriction_id,l.event_campaign_id,f.fund_class HAVING SUM(l.debit-l.credit)<>0 ORDER BY l.accounting_account_id,l.accounting_fund_id,l.fund_restriction_id,l.event_campaign_id LIMIT 251`;
  if (groups.length > 250) throw new HttpError(413, "Annual closing exceeds 250 account/fund/restriction/program groups; reviewed batch support required."); if (!groups.length) return null;
  const maps = new Map(config.policy.mappings.map(m => [m.accountId, m])), annual = config.policy.annual;
  const lines = groups.flatMap(g => { const cls = netAssetClass(g.fundClass, maps.get(g.accountId)?.netAssetClass); if (!["UNRESTRICTED", "RESTRICTED"].includes(cls)) throw new HttpError(409, "Annual temporary balance has no approved net-asset classification.");
    const net = cents(g.net), dims = { accountingFundId: g.fundId, fundRestrictionId: g.restrictionId, eventCampaignId: g.campaignId }, amount = money(net < 0n ? -net : net);
    return [{ accountId: g.accountId, debit: net < 0n ? amount : "0.00", credit: net > 0n ? amount : "0.00", ...dims }, { accountId: cls === "RESTRICTED" ? annual.restrictedAccountId : annual.unrestrictedAccountId, debit: net > 0n ? amount : "0.00", credit: net < 0n ? amount : "0.00", ...dims }]; });
  return { commandId: d.id, fiscalYearId: year.id, reopening: false, expected: { ...base, journalType: "CLOSING", sourceKind: "YEAR_CLOSE", sourceReference: d.id, descriptionSnapshot: `Approved annual closing ${year.yearCode}`, lines } };
}
export async function applyFinalPosting(tx: Prisma.TransactionClient, plan: FinalPostingPlan, journalId: string, actor: string) {
  await tx.accountingJournalDraft.update({ where: { id: plan.commandId }, data: { status: "POSTED", postedJournalId: journalId } });
  await tx.accountingFiscalYear.update({ where: { id: plan.fiscalYearId }, data: { status: plan.reopening ? "OPEN" : "CLOSED", revision: { increment: 1 }, closedAt: plan.reopening ? null : new Date(), closedById: plan.reopening ? null : actor } });
}
export async function applyNonfinancialFinal(tx: Prisma.TransactionClient, actor: string, id: string) {
  const r = await loadApproval(tx, id), identity = await finalIdentity(tx, r), ev = approvalEvidence(r);
  assertAccountingApprovalForPosting({ request: ev, kind: ev.kind, sourceDocumentId: r.sourceDocumentId, sourceVersion: identity.sourceVersion, currentDigest: identity.sourceDigest, hasPostingPermission: await hasAccountingPermission(tx, actor, ACCOUNTING_POST) });
  if (!r.decidedById || !await hasAccountingPermission(tx, r.decidedById, ACCOUNTING_APPROVE)) throw new HttpError(409, "Finalization approver is no longer authorized."); await validateFinalRequest(tx, r);
  const plan = await prepareFinalPosting(tx, r, actor); if (plan) throw new HttpError(409, "Annual balance transfer/reversal requires common GL posting.");
  let draftId: string | null = null;
  if (r.requestKind === "REPORTING_POLICY") {
    const d = await finalDraft(tx, r.sourceDocumentId); if (!d.fiscalYearId) throw new HttpError(409, "Policy fiscal year missing.");
    await tx.accountingFiscalYear.update({ where: { id: d.fiscalYearId }, data: { reportingPolicyDraftId: d.id, revision: { increment: 1 } } }); draftId = d.id;
  } else if (r.requestKind === "REPORT_SNAPSHOT") draftId = r.sourceDocumentId;
  else if (r.requestKind === "BANK_RECONCILIATION") { const p = meta(r.requestPayload), reopening = "bankAction" in p && p.bankAction === "REOPEN"; await tx.accountingBankReconciliation.update({ where: { id: r.sourceDocumentId }, data: { status: reopening ? "OPEN" : "CLOSED", closedAt: reopening ? null : new Date(), closedById: reopening ? null : actor, revision: { increment: 1 } } }); }
  else {
    draftId = commandId(r); const reopen = r.requestKind.endsWith("REOPEN"), data = { status: reopen ? "OPEN" : "CLOSED", revision: { increment: 1 }, closedAt: reopen ? null : new Date(), closedById: reopen ? null : actor };
    if (r.requestKind.startsWith("PERIOD_")) await tx.accountingPeriod.update({ where: { id: r.sourceDocumentId }, data }); else await tx.accountingFiscalYear.update({ where: { id: r.sourceDocumentId }, data });
  }
  if (draftId) await tx.accountingJournalDraft.update({ where: { id: draftId }, data: { status: "APPLIED" } });
  const changed = await tx.accountingApprovalRequest.updateMany({ where: { id, status: "APPROVED", sourceDigest: r.sourceDigest }, data: { status: "APPLIED", appliedById: actor, appliedAt: new Date() } }); if (changed.count !== 1) throw new HttpError(409, "Finalization approval already consumed or changed.");
  await appendApprovalHistory(tx, { approvalRequestId: id, action: "APPLY", actorId: actor, statusBefore: "APPROVED", statusAfter: "APPLIED", sourceDigest: r.sourceDigest });
  return { approvalRequestId: id, financialJournalCreated: false, action: r.requestKind };
}
export async function releaseFinalFreeze(tx: Prisma.TransactionClient, r: Request) {
  if (r.requestKind === "BANK_RECONCILIATION") { const p = meta(r.requestPayload ?? {}); await tx.accountingBankReconciliation.update({ where: { id: r.sourceDocumentId }, data: { status: "bankAction" in p && p.bankAction === "REOPEN" ? "CLOSED" : "OPEN", revision: { increment: 1 } } }); return; }
  if (["REPORTING_POLICY", "REPORT_SNAPSHOT"].includes(r.requestKind)) { await tx.accountingJournalDraft.update({ where: { id: r.sourceDocumentId }, data: { status: "CANCELLED" } }); return; }
  const d = await finalDraft(tx, commandId(r)), reopening = r.requestKind.endsWith("REOPEN"), previous = meta(d.finalizationMetadata).previousClosingDraftId ?? meta(d.finalizationMetadata).snapshot?.priorClosingDraftId ?? null;
  const data = { status: reopening ? "CLOSED" : "OPEN", revision: { increment: 1 }, closingDraftId: previous };
  if (r.requestKind.startsWith("PERIOD_")) await tx.accountingPeriod.update({ where: { id: r.sourceDocumentId }, data }); else await tx.accountingFiscalYear.update({ where: { id: r.sourceDocumentId }, data });
  await tx.accountingJournalDraft.update({ where: { id: d.id }, data: { status: "CANCELLED" } });
}
