import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import { accountingCutoverDate, accountingDateValue } from "../accounting.domain.js";
import { validateLedgerLines } from "../ledger/ledger.domain.js";
import { postLedgerJournalInTransaction } from "../ledger/ledger.service.js";
import { reverseLedgerJournalInTransaction } from "../ledger/ledger-reversal.service.js";
import { requireOpenAccountingPeriod } from "../period/period-control.service.js";
import { decideAccountingApproval } from "./approval.domain.js";
import { ACCOUNTING_MANAGE, ACCOUNTING_APPROVE, ACCOUNTING_POST, appendApprovalHistory,
  approvalEvidence, configuredIndependentApprovers, hasAccountingPermission, loadApproval,
  requireAccountingPermission } from "./approval.repository.js";
import { currentApprovalDigest, draftDigest, draftInclude, loadDraft, loadReversalSource } from "./approval-source.repository.js";
import type { DraftInput, UpdateDraftInput, ApprovalRequestInput } from "./approval.schema.js";
import { aparSourceIdentity, aparSourceView, isAparApprovalKind } from "../apar/apar-source.repository.js";
import { aparReversalContext, prepareAparPosting, validateAparReversal } from "../apar/apar-posting.service.js";
import { AP_MANAGE, AR_MANAGE, managementCode } from "../apar/apar.domain.js";
import { isStage23Kind, isScheduleKind, stage23Identity, validateStage23Request, prepareStage23Posting, applyNonfinancialScheduleApproval } from "../schedules/schedule-approval.service.js";
import { validateStage23Reversal } from "../schedules/schedule-reversal.service.js";
import { loadSchedule, loadSchedulePeriod } from "../schedules/schedule.repository.js";
import { assetIdentity, isAssetKind, validateAssetRequest, prepareAssetPosting, applyAssetCommand } from "../assets/asset-approval.service.js";
import { validateAssetReversal } from "../assets/asset-reversal.service.js";
import { loadAsset, loadRun } from "../assets/asset.repository.js";
import { loadAssetChange } from "../assets/asset-change.service.js";
import { fundIdentity, fundSourceView, isFundKind, nonfinancialFund, validateFundRequest, applyFundCommand } from "../funds/fund-approval.service.js";
import { prepareFundPosting } from "../funds/fund-posting.service.js";
import { validateFundReversal } from "../funds/fund-reversal.service.js";
import { finalIdentity, finalSourceView, isFinalKind, prepareFinalSubmission, prepareFinalPosting, applyNonfinancialFinal, releaseFinalFreeze } from "../finalization/finalization-approval.service.js";

async function atomic<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(work, { isolationLevel: "Serializable", timeout: 30000 }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2034" && attempt < 2) continue;
        if (error.code === "P2002") throw new HttpError(409, "Accounting source or document version already exists; reload before retrying.");
        if (["P2003", "P2004"].includes(error.code)) throw new HttpError(400, "Accounting references or line constraints are invalid.");
      }
      throw error;
    }
  }
}
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
function lines(input: DraftInput) {
  return input.lines.map((line, index) => ({ id: randomUUID(), lineNo: index + 1,
    accountId: line.accountId, debit: new Prisma.Decimal(line.debit), credit: new Prisma.Decimal(line.credit),
    bankAccountId: line.bankAccountId ?? null, accountingFundId: line.accountingFundId ?? null,
    fundRestrictionId: line.fundRestrictionId ?? null, counterpartyId: line.counterpartyId ?? null }));
}
async function validateDraft(tx: Prisma.TransactionClient, input: DraftInput) {
  try { validateLedgerLines(input.lines); }
  catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Invalid journal lines."); }
  const ids = [...new Set(input.lines.map(line => line.accountId))];
  if (await tx.accountingAccount.count({ where: { id: { in: ids }, activeFlag: true, postingFlag: true } }) !== ids.length) {
    throw new HttpError(409, "Draft lines require active posting accounts.");
  }
}
function serializeDraft(draft: Awaited<ReturnType<typeof loadDraft>>) {
  return { ...draft, accountingDate: accountingDateValue(draft.accountingDate),
    lines: draft.lines.map(line => ({ ...line, debit: line.debit.toFixed(2), credit: line.credit.toFixed(2) })) };
}
export async function invalidateRequests(tx: Prisma.TransactionClient, sourceDocumentId: string | readonly string[], actorId: string) {
  const ids = typeof sourceDocumentId === "string" ? [sourceDocumentId] : [...sourceDocumentId];
  if (!ids.length) return;
  const requests = await tx.accountingApprovalRequest.findMany({ where: { sourceDocumentId: { in: ids },
    status: { in: ["PENDING", "APPROVED"] } } });
  if (!requests.length) return;
  const changed = await tx.accountingApprovalRequest.updateMany({ where: { id: { in: requests.map(r => r.id) }, status: { in: ["PENDING", "APPROVED"] } }, data: { status: "SUPERSEDED" } });
  if (changed.count !== requests.length) throw new HttpError(409, "Approval changed during document revision.");
  await tx.accountingApprovalHistory.createMany({ data: requests.map(request => ({ approvalRequestId: request.id, action: "SUPERSEDE", actorId,
      statusBefore: request.status, statusAfter: "SUPERSEDED", sourceDigest: request.sourceDigest,
      remark: "Source revised or replaced by a new request." })) });
}

async function sourceManagementPermission(tx: Prisma.TransactionClient, request: {
  requestKind: string; sourceDocumentId: string; requestPayload?: unknown;
}) {
  if (isAparApprovalKind(request.requestKind)) return (await aparSourceIdentity(tx, request)).managePermission;
  if (request.requestKind === "JOURNAL_REVERSAL") {
    const context = await aparReversalContext(tx, request.sourceDocumentId);
    if (context?.type === "DOCUMENT" || context?.type === "SETTLEMENT") return managementCode(context.kind);
    if (context?.type === "ADJUSTMENT") return AR_MANAGE;
  }
  return ACCOUNTING_MANAGE;
}

export function createDraft(actorId: string, input: DraftInput) {
  return atomic(tx => createDraftInTransaction(tx, actorId, input));
}
export async function createDraftInTransaction(tx: Prisma.TransactionClient, actorId: string, input: DraftInput) {
    await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
    await requireOpenAccountingPeriod(tx, date(input.accountingDate));
    await validateDraft(tx, input);
    const id = randomUUID();
    return serializeDraft(await tx.accountingJournalDraft.create({ data: { id, draftNumber: `DRAFT-${id}`,
      journalType: input.journalType, sourceKind: input.journalType === "MANUAL" ? "MANUAL_JOURNAL" : "ADJUSTING_JOURNAL",
      sourceReference: input.sourceReference, accountingDate: date(input.accountingDate), description: input.description,
      createdById: actorId, lines: { create: lines(input) } }, include: draftInclude }));
}
export function updateDraft(actorId: string, id: string, input: UpdateDraftInput) {
  return atomic(async tx => {
    await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
    const draft = await loadDraft(tx, id);
    if (!["MANUAL_JOURNAL", "ADJUSTING_JOURNAL"].includes(draft.sourceKind)) throw new HttpError(409, "Use the source-specific accrual revision endpoint.");
    if (draft.createdById !== actorId) throw new HttpError(403, "Only the draft creator may revise it.");
    if (draft.status !== "DRAFT" || draft.revision !== input.expectedRevision) {
      throw new HttpError(409, "Posted/cancelled drafts cannot be edited; reload the current revision.");
    }
    await validateDraft(tx, input);
    const changed = await tx.accountingJournalDraft.updateMany({ where: { id, status: "DRAFT", revision: input.expectedRevision },
      data: { journalType: input.journalType,
        sourceKind: input.journalType === "MANUAL" ? "MANUAL_JOURNAL" : "ADJUSTING_JOURNAL",
        sourceReference: input.sourceReference, accountingDate: date(input.accountingDate),
        description: input.description, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new HttpError(409, "Draft was changed concurrently.");
    await invalidateRequests(tx, id, actorId);
    await tx.accountingJournalDraftLine.deleteMany({ where: { journalDraftId: id } });
    await tx.accountingJournalDraftLine.createMany({ data: lines(input).map(line => ({ ...line, journalDraftId: id })) });
    return serializeDraft(await loadDraft(tx, id));
  });
}
export function listDrafts(actorId: string, page: number, pageSize: number) {
  return atomic(async tx => {
    await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
    const where = { createdById: actorId };
    const [total, rows] = await Promise.all([tx.accountingJournalDraft.count({ where }),
      tx.accountingJournalDraft.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize, take: pageSize, select: { id: true, draftNumber: true,
          journalType: true, accountingDate: true, description: true, revision: true, status: true, postedJournalId: true } })]);
    return { page, pageSize, total, rows };
  });
}
export function getDraft(actorId: string, id: string) {
  return atomic(async tx => {
    await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
    const draft = await loadDraft(tx, id);
    if (draft.createdById !== actorId) throw new HttpError(403, "Draft is not owned by this user.");
    return serializeDraft(draft);
  });
}

export function submitApproval(actorId: string, input: ApprovalRequestInput) {
  return atomic(tx => submitApprovalInTransaction(tx, actorId, input));
}
export async function submitApprovalInTransaction(tx: Prisma.TransactionClient, actorId: string, input: ApprovalRequestInput) {
    let sourceVersion: number;
    let sourceDigest: string;
    let payload: Prisma.InputJsonValue | undefined;
    let accountingDate: Date;
    let sourceLink: { journalDraftId?: string; originalJournalId?: string; accountingDocumentId?: string; accountingSettlementId?: string; accountingScheduleId?: string; accountingSchedulePeriodId?: string; fixedAssetId?: string; depreciationRunId?: string; accountingFundId?: string; fundRestrictionId?: string; fundDesignationId?: string; releaseEvidenceLineId?: string; fiscalYearId?: string; bankReconciliationId?: string; accountingPeriodId?: string };
    if (input.kind === "REPORTING_POLICY" || input.kind === "REPORT_SNAPSHOT" || input.kind === "BANK_RECONCILIATION" || input.kind === "PERIOD_CLOSE" || input.kind === "PERIOD_REOPEN" || input.kind === "YEAR_CLOSE" || input.kind === "YEAR_REOPEN") {
      await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE); payload = { ...(input.commandId ? { commandId: input.commandId } : {}), ...(input.bankAction ? { bankAction: input.bankAction, reason: input.reason ?? null, evidenceReference: input.evidenceReference ?? null } : {}) };
      const r = { requestKind: input.kind, sourceDocumentId: input.sourceDocumentId, requestPayload: payload };
      const before = await finalIdentity(tx, r); if (before.requesterId !== actorId || before.sourceVersion !== input.expectedRevision) throw new HttpError(409, "Finalization owner/source revision is stale.");
      await prepareFinalSubmission(tx, r); const source = await finalIdentity(tx, r); sourceVersion = source.sourceVersion; sourceDigest = source.sourceDigest; sourceLink = source.sourceLink; accountingDate = source.accountingDate; payload = { ...payload, snapshot: source.material };
    } else if (input.kind === "FUND_SETUP" || input.kind === "FUND_RESTRICTION" || input.kind === "FUND_DESIGNATION" || input.kind === "FUND_RELEASE" || input.kind === "FUND_COMMAND" || input.kind === "FUND_JOURNAL") {
      await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
      payload = input.release ? { release: input.release } : {};
      const r = { requestKind: input.kind, sourceDocumentId: input.sourceDocumentId, requestPayload: payload }, source = await fundIdentity(tx, r);
      if (source.sourceVersion !== input.expectedRevision || input.kind !== "FUND_RELEASE" && source.requesterId !== actorId) throw new HttpError(409, "Fund source owner/revision is stale.");
      await validateFundRequest(tx, r); sourceVersion = source.sourceVersion;
      if (input.kind === "FUND_RELEASE") { const latest = await tx.accountingApprovalRequest.aggregate({ where: { requestKind: input.kind, sourceDocumentId: input.sourceDocumentId }, _max: { sourceVersion: true } }); sourceVersion = (latest._max.sourceVersion ?? 0) + 1; }
      sourceDigest = source.sourceDigest; accountingDate = source.accountingDate; sourceLink = source.sourceLink; payload = { ...payload, snapshot: source.material };
    } else if (input.kind === "ASSET_ACTIVATE" || input.kind === "ASSET_CHANGE" || input.kind === "ASSET_JOURNAL" || input.kind === "DEPRECIATION_RUN") {
      await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
      const request = { requestKind: input.kind, sourceDocumentId: input.sourceDocumentId }, source = await assetIdentity(tx, request);
      if (source.requesterId !== actorId || source.sourceVersion !== input.expectedRevision) throw new HttpError(409, "Asset source owner/revision is stale.");
      await validateAssetRequest(tx, request); sourceVersion = source.sourceVersion; sourceDigest = source.sourceDigest; sourceLink = source.sourceLink;
      accountingDate = source.accountingDate; payload = { snapshot: source.material };
    } else if (input.kind === "ACCRUAL_DOCUMENT" || input.kind === "ACCRUAL_ADJUSTMENT" || input.kind === "SCHEDULE_PERIOD"
      || input.kind === "SCHEDULE_SETUP" || input.kind === "SCHEDULE_CHANGE" || input.kind === "SCHEDULE_CANCEL" || input.kind === "SCHEDULE_TERMINATE") {
      await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
      payload = { ...(input.command ? { command: input.command } : {}), ...(input.recognitionEvidence ? { recognitionEvidence: input.recognitionEvidence } : {}) };
      const source = await stage23Identity(tx, { requestKind: input.kind, sourceDocumentId: input.sourceDocumentId, requestPayload: payload });
      if (source.requesterId !== actorId || source.sourceVersion !== input.expectedRevision) throw new HttpError(409, "Source owner or revision is stale.");
      await validateStage23Request(tx, { requestKind: input.kind, sourceDocumentId: input.sourceDocumentId, requestPayload: payload });
      sourceVersion = source.sourceVersion; sourceDigest = source.sourceDigest; sourceLink = source.sourceLink; accountingDate = source.accountingDate;
      payload = { ...payload, snapshot: source.material };
    } else if (input.kind === "AP_INVOICE" || input.kind === "AR_DOCUMENT" || input.kind === "SETTLEMENT" || input.kind === "AR_ADJUSTMENT") {
      if (input.kind === "AR_ADJUSTMENT") {
        const { kind: _kind, sourceDocumentId: _source, ...adjustment } = input;
        payload = adjustment;
      }
      const source = await aparSourceIdentity(tx, { requestKind: input.kind, sourceDocumentId: input.sourceDocumentId, requestPayload: payload });
      await requireAccountingPermission(tx, actorId, source.managePermission);
      if (input.kind !== "AR_ADJUSTMENT" && (source.requesterId !== actorId || source.sourceVersion !== input.expectedRevision)) {
        throw new HttpError(409, "AP/AR source owner or revision does not match this submission.");
      }
      await prepareAparPosting(tx, { requestKind: input.kind, sourceDocumentId: input.sourceDocumentId, requestPayload: payload }, actorId);
      sourceVersion = source.sourceVersion;
      if (input.kind === "AR_ADJUSTMENT") {
        const latest = await tx.accountingApprovalRequest.aggregate({ where: { requestKind: input.kind,
          sourceDocumentId: input.sourceDocumentId }, _max: { sourceVersion: true } });
        sourceVersion = (latest._max.sourceVersion ?? 0) + 1;
      }
      sourceDigest = source.sourceDigest;
      accountingDate = source.accountingDate;
      sourceLink = input.kind === "SETTLEMENT" ? { accountingSettlementId: input.sourceDocumentId } : { accountingDocumentId: input.sourceDocumentId };
    } else if (input.kind === "JOURNAL_REVERSAL") {
      await requireAccountingPermission(tx, actorId, await sourceManagementPermission(tx,
        { requestKind: input.kind, sourceDocumentId: input.sourceDocumentId }));
      payload = { accountingDate: input.accountingDate, remark: input.remark };
      const source = await loadReversalSource(tx, input.sourceDocumentId, payload);
      if (source.original.sourceKind === "YEAR_CLOSE") throw new HttpError(409, "Use independently approved annual reopening for a year-end closing journal.");
      if (source.original.journalType === "REVERSAL" || date(input.accountingDate) < source.original.accountingDate) {
        throw new HttpError(409, "Reversal source or accounting date is not eligible.");
      }
      if (await tx.accountingJournal.findUnique({ where: { reversalOfJournalId: source.original.id }, select: { id: true } })) {
        throw new HttpError(409, "Original journal has already been reversed.");
      }
      await validateAparReversal(tx, source.original.id, date(input.accountingDate));
      await validateStage23Reversal(tx, source.original.id, date(input.accountingDate));
      await validateAssetReversal(tx, source.original.id, date(input.accountingDate));
      await validateFundReversal(tx, source.original.id, date(input.accountingDate));
      const latest = await tx.accountingApprovalRequest.aggregate({ where: {
        requestKind: input.kind, sourceDocumentId: input.sourceDocumentId }, _max: { sourceVersion: true } });
      sourceVersion = (latest._max.sourceVersion ?? 0) + 1;
      sourceDigest = source.digest;
      accountingDate = date(input.accountingDate);
      await invalidateRequests(tx, input.sourceDocumentId, actorId);
      sourceLink = { originalJournalId: input.sourceDocumentId };
    } else {
      await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
      const draft = await loadDraft(tx, input.sourceDocumentId);
      if (draft.createdById !== actorId) throw new HttpError(403, "Only the creator may submit this draft.");
      if (draft.status !== "DRAFT" || draft.revision !== input.expectedRevision
        || draft.sourceKind !== input.kind) throw new HttpError(409, "Draft version or journal type does not match this request.");
      sourceVersion = draft.revision;
      sourceDigest = draftDigest(draft);
      accountingDate = draft.accountingDate;
      sourceLink = { journalDraftId: input.sourceDocumentId };
    }
    if (!isFinalKind(input.kind)) {
      if (accountingDate < accountingCutoverDate()) throw new HttpError(409, "Approval source cannot predate Accounting cutover.");
      await requireOpenAccountingPeriod(tx, accountingDate);
    }
    const approvers = await configuredIndependentApprovers(tx, actorId);
    const request = await tx.accountingApprovalRequest.create({ data: {
      requestKind: input.kind, sourceDocumentId: input.sourceDocumentId, sourceVersion, sourceDigest,
      requestPayload: payload, requestedById: actorId,
      ...sourceLink,
      approvers: { create: approvers.map(approverUserId => ({ approverUserId })) },
      history: { create: { action: "SUBMIT", statusAfter: "PENDING", actorId, sourceDigest } }
    }, include: { approvers: true } });
    return request;
}

export function decideApproval(actorId: string, id: string, decision: "APPROVED" | "REJECTED", remark: string | null) {
  return atomic(async tx => {
    const request = await loadApproval(tx, id);
    const currentDigest = await currentApprovalDigest(tx, request);
    const result = decideAccountingApproval({ request: approvalEvidence(request), actorId,
      hasPermission: await hasAccountingPermission(tx, actorId, ACCOUNTING_APPROVE), currentDigest,
      decision, decidedAt: new Date(), remark });
    const changed = await tx.accountingApprovalRequest.updateMany({ where: { id, status: "PENDING",
      sourceDigest: request.sourceDigest }, data: { status: result.status, decidedById: result.decidedById,
      decidedAt: result.decidedAt, decisionRemark: result.decisionRemark } });
    if (changed.count !== 1) throw new HttpError(409, "Approval has already been decided.");
    if (decision === "REJECTED" && isFinalKind(request.requestKind)) await releaseFinalFreeze(tx, request);
    await appendApprovalHistory(tx, { approvalRequestId: id, action: result.historyAction,
      statusBefore: "PENDING", statusAfter: result.status, actorId, actionAt: result.decidedAt,
      sourceDigest: result.sourceDigest, remark });
    return loadApproval(tx, id);
  });
}
export function cancelApproval(actorId: string, id: string, remark: string) {
  return atomic(async tx => {
    const request = await loadApproval(tx, id);
    const owner = request.requestedById === actorId && await hasAccountingPermission(tx, actorId, await sourceManagementPermission(tx, request));
    const reviewer = request.approvers.some(a => a.approverUserId === actorId)
      && await hasAccountingPermission(tx, actorId, ACCOUNTING_APPROVE);
    if (!owner && !reviewer) throw new HttpError(403, "User cannot cancel this Accounting approval.");
    if (!["PENDING", "APPROVED"].includes(request.status)) throw new HttpError(409, "Approval can no longer be cancelled.");
    const changed = await tx.accountingApprovalRequest.updateMany({ where: { id, status: request.status }, data: { status: "CANCELLED" } });
    if (changed.count !== 1) throw new HttpError(409, "Approval changed concurrently.");
    if (isFinalKind(request.requestKind)) await releaseFinalFreeze(tx, request);
    await appendApprovalHistory(tx, { approvalRequestId: id, action: "CANCEL", statusBefore: request.status,
      statusAfter: "CANCELLED", actorId, sourceDigest: request.sourceDigest, remark });
    return loadApproval(tx, id);
  });
}
export function postApprovedJournal(actorId: string, id: string) {
  return atomic(tx => postApprovedJournalInTransaction(tx, actorId, id));
}
export function applyApprovedAction(actorId: string, id: string) {
  return atomic(async tx => {
    await requireAccountingPermission(tx, actorId, ACCOUNTING_POST);
    const request = await loadApproval(tx, id);
    if (isFinalKind(request.requestKind)) {
      const plan = await prepareFinalPosting(tx, request, actorId);
      return plan ? postLedgerJournalInTransaction(tx, plan.expected) : applyNonfinancialFinal(tx, actorId, id);
    }
    if (nonfinancialFund(request.requestKind)) return applyFundCommand(tx, actorId, id);
    if (["ASSET_ACTIVATE", "ASSET_CHANGE"].includes(request.requestKind)) return applyAssetCommand(tx, actorId, id);
    return ["SCHEDULE_SETUP", "SCHEDULE_CHANGE", "SCHEDULE_CANCEL"].includes(request.requestKind)
      ? applyNonfinancialScheduleApproval(tx, actorId, id) : postApprovedJournalInTransaction(tx, actorId, id);
  });
}
export async function postApprovedJournalInTransaction(tx: Prisma.TransactionClient, actorId: string, id: string) {
    await requireAccountingPermission(tx, actorId, ACCOUNTING_POST);
    const request = await loadApproval(tx, id);
    if (isFinalKind(request.requestKind)) { const plan = await prepareFinalPosting(tx, request, actorId); if (!plan) throw new HttpError(409, "Use approved action application for this nonfinancial finalization."); return postLedgerJournalInTransaction(tx, plan.expected); }
    if (isFundKind(request.requestKind)) return postLedgerJournalInTransaction(tx, (await prepareFundPosting(tx, request, actorId)).expected);
    if (isAssetKind(request.requestKind)) {
      if (["ASSET_ACTIVATE", "ASSET_CHANGE"].includes(request.requestKind)) throw new HttpError(409, "Use approved action application for nonfinancial asset changes.");
      return postLedgerJournalInTransaction(tx, (await prepareAssetPosting(tx, request, actorId)).expected);
    }
    if (isStage23Kind(request.requestKind)) {
      if (["SCHEDULE_SETUP", "SCHEDULE_CHANGE", "SCHEDULE_CANCEL"].includes(request.requestKind)) throw new HttpError(409, "Use approved action application for a nonfinancial schedule command.");
      return postLedgerJournalInTransaction(tx, (await prepareStage23Posting(tx, request, actorId)).expected);
    }
    if (isAparApprovalKind(request.requestKind)) {
      return postLedgerJournalInTransaction(tx, (await prepareAparPosting(tx, request, actorId)).expected);
    }
    if (request.requestKind === "JOURNAL_REVERSAL") {
      const source = await loadReversalSource(tx, request.sourceDocumentId, request.requestPayload);
      return reverseLedgerJournalInTransaction(tx, { approvalRequestId: id,
        originalJournalId: source.original.id, accountingDate: date(source.payload.accountingDate), postedById: actorId });
    }
    if (!["MANUAL_JOURNAL", "ADJUSTING_JOURNAL"].includes(request.requestKind)) {
      throw new HttpError(409, "This source workflow is not enabled in Stage 2.1.");
    }
    const draft = await loadDraft(tx, request.sourceDocumentId);
    if (draft.journalType !== "MANUAL" && draft.journalType !== "ADJUSTMENT") throw new HttpError(409, "Draft journal type is invalid.");
    return postLedgerJournalInTransaction(tx, { approvalRequestId: id, journalType: draft.journalType,
      sourceKind: draft.sourceKind, sourceReference: draft.sourceReference, accountingDate: draft.accountingDate,
      postedById: actorId, descriptionSnapshot: draft.description, lines: draft.lines.map(line => ({
        accountId: line.accountId, debit: line.debit.toFixed(2), credit: line.credit.toFixed(2),
        bankAccountId: line.bankAccountId, accountingFundId: line.accountingFundId,
        fundRestrictionId: line.fundRestrictionId, counterpartyId: line.counterpartyId })) });
}
export function listApprovals(actorId: string, query: { page: number; pageSize: number; status?: string }) {
  return atomic(async tx => {
    if (!await hasAccountingPermission(tx, actorId, ACCOUNTING_MANAGE)
      && !await hasAccountingPermission(tx, actorId, ACCOUNTING_APPROVE)
      && !await hasAccountingPermission(tx, actorId, AP_MANAGE)
      && !await hasAccountingPermission(tx, actorId, AR_MANAGE)
      && !await hasAccountingPermission(tx, actorId, ACCOUNTING_POST)) throw new HttpError(403, "Accounting permission is required.");
    const where = { status: query.status, OR: [{ requestedById: actorId }, { approvers: { some: { approverUserId: actorId } } }] };
    const [total, rows] = await Promise.all([tx.accountingApprovalRequest.count({ where }),
      tx.accountingApprovalRequest.findMany({ where, orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize, take: query.pageSize })]);
    return { ...query, total, rows };
  });
}
export function getApproval(actorId: string, id: string) {
  return atomic(async tx => {
    const request = await loadApproval(tx, id);
    const owner = request.requestedById === actorId && await hasAccountingPermission(tx, actorId, await sourceManagementPermission(tx, request));
    const reviewer = request.approvers.some(a => a.approverUserId === actorId)
      && await hasAccountingPermission(tx, actorId, ACCOUNTING_APPROVE);
    const poster = await hasAccountingPermission(tx, actorId, ACCOUNTING_POST);
    if (!owner && !reviewer && !poster) throw new HttpError(403, "User cannot view this Accounting approval.");
    const history = await tx.accountingApprovalHistory.findMany({ where: { approvalRequestId: id },
      orderBy: [{ actionAt: "asc" }, { id: "asc" }], take: 1000 });
    const source = isFinalKind(request.requestKind) ? await finalSourceView(tx, request) : isFundKind(request.requestKind) ? await fundSourceView(tx, request)
      : isAssetKind(request.requestKind) ? (request.requestKind === "ASSET_ACTIVATE" ? await loadAsset(tx, request.sourceDocumentId) : request.requestKind === "DEPRECIATION_RUN" ? await loadRun(tx, request.sourceDocumentId) : await loadAssetChange(tx, request.sourceDocumentId))
      : isScheduleKind(request.requestKind) ? (request.requestKind === "SCHEDULE_PERIOD" ? await loadSchedulePeriod(tx, request.sourceDocumentId) : await loadSchedule(tx, request.sourceDocumentId))
      : isAparApprovalKind(request.requestKind) ? await aparSourceView(tx, request) : request.requestKind === "JOURNAL_REVERSAL"
      ? await loadReversalSource(tx, request.sourceDocumentId, request.requestPayload)
      : serializeDraft(await loadDraft(tx, request.sourceDocumentId));
    return { ...request, history, historyLimit: 1000, source };
  });
}

export function getApprovalSettings(actorId: string) {
  return atomic(async tx => {
    await requireAccountingPermission(tx, actorId, "CONFIG_APPROVAL");
    const menu = await tx.menu.findFirst({ where: { menuCode: ACCOUNTING_APPROVE, activeFlag: true, menuType: "PAGE" } });
    if (!menu) throw new HttpError(409, "Accounting approval permission definition has not been provisioned.");
    const [configuration, approverUsers] = await Promise.all([
      tx.approvalConfig.findUnique({ where: { menuId: menu.id }, include: { approvers: true } }),
      tx.user.findMany({ where: { status: "ACTIVE", userRoles: { some: { role: { is: {
        activeFlag: true, roleMenus: { some: { menu: { is: { menuCode: ACCOUNTING_APPROVE,
          menuType: "PAGE", activeFlag: true } } } } } } } } }, select: { id: true, fullName: true, email: true },
        orderBy: [{ fullName: "asc" }, { id: "asc" }], take: 500 })
    ]);
    return { configuration, approverUsers, approverUsersLimit: 500 };
  });
}
export function updateApprovalSettings(actorId: string, input: { activeFlag: boolean; approverUserIds: string[] }) {
  return atomic(async tx => {
    await requireAccountingPermission(tx, actorId, "CONFIG_APPROVAL");
    const menus = await tx.menu.findMany({ where: { menuCode: ACCOUNTING_APPROVE, activeFlag: true, menuType: "PAGE" }, take: 2 });
    if (menus.length !== 1 || !menus[0]) throw new HttpError(409, "Exactly one active Accounting approval permission definition is required.");
    if (input.activeFlag && !input.approverUserIds.length) throw new HttpError(400, "Active approval requires an independent approver.");
    const eligible = input.approverUserIds.length ? await tx.user.count({ where: { id: { in: input.approverUserIds }, status: "ACTIVE",
      userRoles: { some: { role: { is: { activeFlag: true, roleMenus: { some: { menu: { is: {
        menuCode: ACCOUNTING_APPROVE, menuType: "PAGE", activeFlag: true } } } } } } } } } }) : 0;
    if (eligible !== input.approverUserIds.length) throw new HttpError(400, "Every Accounting approver must be active and hold approval permission.");
    const configuration = await tx.approvalConfig.upsert({ where: { menuId: menus[0].id },
      create: { menuId: menus[0].id, activeFlag: input.activeFlag, createdById: actorId, updatedById: actorId },
      update: { activeFlag: input.activeFlag, updatedById: actorId } });
    await tx.approvalConfigApprover.deleteMany({ where: { approvalConfigId: configuration.id,
      approverUserId: { notIn: input.approverUserIds } } });
    const existing = await tx.approvalConfigApprover.findMany({ where: { approvalConfigId: configuration.id }, select: { approverUserId: true } });
    const existingIds = new Set(existing.map(item => item.approverUserId));
    const added = input.approverUserIds.filter(id => !existingIds.has(id));
    if (added.length) await tx.approvalConfigApprover.createMany({ data: added.map(approverUserId => ({
      approvalConfigId: configuration.id, approverUserId, createdById: actorId })) });
    return tx.approvalConfig.findUniqueOrThrow({ where: { id: configuration.id }, include: { approvers: true } });
  });
}
