import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { accountingDateValue } from "../accounting.domain.js";
import type { PostedJournalInput } from "../ledger/posted-journal.service.js";
import { accountingApprovalDigest, assertAccountingApprovalForPosting, type AccountingApprovalKind } from "./approval.domain.js";
import { ACCOUNTING_APPROVE, ACCOUNTING_POST, appendApprovalHistory, approvalEvidence,
  hasAccountingPermission, loadApproval } from "./approval.repository.js";
import { draftDigest, loadDraft, loadReversalSource } from "./approval-source.repository.js";
import { aparSourceIdentity, isAparApprovalKind } from "../apar/apar-source.repository.js";
import { applyAparPosting, applyAparReversal, prepareAparPosting, validateAparReversal, type AparPostingPlan } from "../apar/apar-posting.service.js";
import { isStage23Kind, prepareStage23Posting, stage23Identity, applyStage23Posting, type SchedulePostingPlan } from "../schedules/schedule-approval.service.js";
import { applyStage23Reversal, validateStage23Reversal } from "../schedules/schedule-reversal.service.js";
import { assetIdentity, isAssetKind, prepareAssetPosting, applyAssetPosting, type AssetPostingPlan } from "../assets/asset-approval.service.js";
import { applyAssetReversal, validateAssetReversal } from "../assets/asset-reversal.service.js";
import { fundIdentity, isFundKind } from "../funds/fund-approval.service.js";
import { applyFundPosting, prepareFundPosting, type FundPostingPlan } from "../funds/fund-posting.service.js";
import { applyFundReversal, validateFundReversal } from "../funds/fund-reversal.service.js";
import { finalIdentity, isFinalKind, prepareFinalPosting, applyFinalPosting, type FinalPostingPlan } from "../finalization/finalization-approval.service.js";
import { validateBankAdjustment, validateMatchedBankReversal } from "../finalization/bank-reconciliation.service.js";

type MaterialLine = { accountId: string; lineNo: number; debit: string | Prisma.Decimal; credit: string | Prisma.Decimal;
  bankAccountId?: string | null; accountingFundId?: string | null; fundRestrictionId?: string | null;
  counterpartyId?: string | null; eventCodeId?: string | null; eventCampaignId?: string | null;
  memberIdentityId?: string | null; memberId?: string | null };
type MaterialHeader = Omit<PostedJournalInput, "lines"> & { lines: MaterialLine[] };
function postingMaterial(input: MaterialHeader) {
  return { journalType: input.journalType, sourceKind: input.sourceKind, sourceReference: input.sourceReference,
    accountingDate: accountingDateValue(input.accountingDate), description: input.descriptionSnapshot,
    bankTransactionId: input.bankTransactionId ?? null, correctionItemId: input.correctionItemId ?? null,
    relatedJournalId: input.relatedJournalId ?? null, reversalOfJournalId: input.reversalOfJournalId ?? null,
    lines: input.lines.map(line => ({ accountId: line.accountId, lineNo: String(line.lineNo),
      debit: new Prisma.Decimal(line.debit).toFixed(2), credit: new Prisma.Decimal(line.credit).toFixed(2),
      bankAccountId: line.bankAccountId ?? null, accountingFundId: line.accountingFundId ?? null,
      fundRestrictionId: line.fundRestrictionId ?? null, counterpartyId: line.counterpartyId ?? null,
      eventCodeId: line.eventCodeId ?? null, eventCampaignId: line.eventCampaignId ?? null,
      memberIdentityId: line.memberIdentityId ?? null, memberId: line.memberId ?? null })) };
}

/** Enforced by the common persistence gate, including callers outside the HTTP workflow. */
export async function verifyJournalApproval(tx: Prisma.TransactionClient, input: PostedJournalInput) {
  const finalRequired = input.journalType === "CLOSING" || ["YEAR_CLOSE", "YEAR_REOPEN"].includes(input.sourceKind);
  const fundRequired = ["FUND_CLASSIFY", "FUND_OPENING", "FUND_RESTRICTION", "FUND_RELEASE"].includes(input.sourceKind) || input.journalType === "FUND_RELEASE";
  const stage23Required = ["ACCRUAL_DOCUMENT", "ACCRUAL_ADJUSTMENT", "SCHEDULE_RECOGNITION", "SCHEDULE_TERMINATION"].includes(input.sourceKind);
  const assetRequired = ["ASSET_JOURNAL", "DEPRECIATION_RUN"].includes(input.sourceKind);
  const aparRequired = !fundRequired && !assetRequired && !stage23Required && (["AP_DOCUMENT", "AR_DOCUMENT", "AP_SETTLEMENT", "AR_SETTLEMENT", "AR_ADJUSTMENT"].includes(input.sourceKind)
    || ["PAYMENT", "RECEIPT"].includes(input.journalType)
    || input.journalType === "RECOGNITION" && input.sourceKind !== "FINALIZED_BANK_TRANSACTION");
  if (!finalRequired && !fundRequired && !assetRequired && !stage23Required && !aparRequired && !["MANUAL", "ADJUSTMENT", "REVERSAL"].includes(input.journalType)) return null;
  if (!input.approvalRequestId) throw new HttpError(409, "A persisted Accounting approval is required for this journal type.");
  const request = await loadApproval(tx, input.approvalRequestId);
  let kind: AccountingApprovalKind = input.journalType === "MANUAL" ? "MANUAL_JOURNAL"
    : input.journalType === "ADJUSTMENT" ? "ADJUSTING_JOURNAL" : "JOURNAL_REVERSAL";
  let currentDigest: string;
  let expected: MaterialHeader;
  let draftId: string | null = null;
  let aparPlan: AparPostingPlan | undefined;
  let schedulePlan: SchedulePostingPlan | undefined;
  let assetPlan: AssetPostingPlan | undefined;
  let fundPlan: FundPostingPlan | undefined;
  let finalPlan: FinalPostingPlan | undefined;
  let reversalOriginalId: string | undefined;
  if (aparRequired && !isAparApprovalKind(request.requestKind)) throw new HttpError(409, "AP/AR journal requires its matching source approval.");
  if (stage23Required && !isStage23Kind(request.requestKind)) throw new HttpError(409, "Schedule/accrual posting requires its own source approval.");
  if (assetRequired && !isAssetKind(request.requestKind)) throw new HttpError(409, "Asset journal requires its persisted source approval.");
  if (fundRequired && !isFundKind(request.requestKind)) throw new HttpError(409, "Fund financial events require their persisted matching source approval.");
  if (finalRequired && !isFinalKind(request.requestKind)) throw new HttpError(409, "Year closing/reopening requires its matching persisted fiscal approval.");
  if (isFinalKind(request.requestKind)) {
    kind = approvalEvidence(request).kind; const identity = await finalIdentity(tx, request);
    if (request.sourceVersion !== identity.sourceVersion || request.requestedById !== identity.requesterId || request.fiscalYearId !== request.sourceDocumentId) throw new HttpError(409, "Annual closing source version/identity is stale.");
    const plan = await prepareFinalPosting(tx, request, input.postedById); if (!plan) throw new HttpError(409, "A nonfinancial finalization cannot create a journal."); finalPlan = plan;
    currentDigest = identity.sourceDigest; expected = { ...plan.expected, lines: plan.expected.lines.map((l, i) => ({ ...l, lineNo: i + 1 })) };
  } else if (isFundKind(request.requestKind)) {
    kind = approvalEvidence(request).kind;
    const identity = await fundIdentity(tx, request);
    if (request.requestKind !== "FUND_RELEASE" && (request.sourceVersion !== identity.sourceVersion || request.requestedById !== identity.requesterId)
      || Object.entries(identity.sourceLink).some(([key, value]) => request[key as keyof typeof request] !== value)) throw new HttpError(409, "Fund source identity/reference/version is stale.");
    fundPlan = await prepareFundPosting(tx, request, input.postedById); draftId = fundPlan.draftId ?? null;
    currentDigest = identity.sourceDigest; expected = { ...fundPlan.expected, lines: fundPlan.expected.lines.map((line, i) => ({ ...line, lineNo: i + 1 })) };
  } else if (isAssetKind(request.requestKind)) {
    kind = approvalEvidence(request).kind;
    const identity = await assetIdentity(tx, request);
    if (request.sourceVersion !== identity.sourceVersion || request.requestedById !== identity.requesterId
      || "fixedAssetId" in identity.sourceLink && request.fixedAssetId !== identity.sourceLink.fixedAssetId
      || "depreciationRunId" in identity.sourceLink && request.depreciationRunId !== identity.sourceLink.depreciationRunId
      || "journalDraftId" in identity.sourceLink && request.journalDraftId !== identity.sourceLink.journalDraftId) throw new HttpError(409, "Asset approval source version/reference is stale.");
    assetPlan = await prepareAssetPosting(tx, request, input.postedById); draftId = assetPlan.changeId ?? null;
    currentDigest = identity.sourceDigest; expected = { ...assetPlan.expected, lines: assetPlan.expected.lines.map((line, i) => ({ ...line, lineNo: i + 1 })) };
  } else if (isStage23Kind(request.requestKind)) {
    kind = approvalEvidence(request).kind;
    const identity = await stage23Identity(tx, request);
    if (request.sourceVersion !== identity.sourceVersion || request.requestedById !== identity.requesterId
      || "journalDraftId" in identity.sourceLink && request.journalDraftId !== identity.sourceLink.journalDraftId
      || "accountingScheduleId" in identity.sourceLink && request.accountingScheduleId !== identity.sourceLink.accountingScheduleId
      || "accountingSchedulePeriodId" in identity.sourceLink && request.accountingSchedulePeriodId !== identity.sourceLink.accountingSchedulePeriodId) throw new HttpError(409, "Stage 2.3 source owner/version/reference is stale.");
    schedulePlan = await prepareStage23Posting(tx, request, input.postedById);
    draftId = schedulePlan.draftId ?? null;
    currentDigest = identity.sourceDigest;
    expected = { ...schedulePlan.expected, lines: schedulePlan.expected.lines.map((line, index) => ({ ...line, lineNo: index + 1 })) };
  } else if (isAparApprovalKind(request.requestKind)) {
    kind = approvalEvidence(request).kind;
    aparPlan = await prepareAparPosting(tx, request, input.postedById);
    const identity = await aparSourceIdentity(tx, request);
    if (request.requestKind !== "AR_ADJUSTMENT" && (request.sourceVersion !== aparPlan.revision
      || request.requestedById !== identity.requesterId)) throw new HttpError(409, "AP/AR approval version or source owner is stale.");
    if (request.requestKind === "SETTLEMENT" ? request.accountingSettlementId !== request.sourceDocumentId
      : request.accountingDocumentId !== request.sourceDocumentId) throw new HttpError(409, "AP/AR approval source mismatch.");
    currentDigest = identity.sourceDigest;
    expected = { ...aparPlan.expected, lines: aparPlan.expected.lines.map((line, index) => ({ ...line, lineNo: index + 1 })) };
  } else if (kind !== "JOURNAL_REVERSAL") {
    const draft = await loadDraft(tx, request.sourceDocumentId);
    await validateBankAdjustment(tx, draft);
    if (request.journalDraftId !== draft.id || request.requestedById !== draft.createdById
      || draft.status !== "DRAFT" || draft.revision !== request.sourceVersion || draft.journalType !== input.journalType) {
      throw new HttpError(409, "Approval source draft is no longer current or postable.");
    }
    draftId = draft.id;
    currentDigest = draftDigest(draft);
    expected = { journalType: draft.journalType, sourceKind: draft.sourceKind, sourceReference: draft.sourceReference,
      accountingDate: draft.accountingDate, descriptionSnapshot: draft.description, postedById: input.postedById,
      lines: draft.lines };
  } else {
    const { original, payload, digest } = await loadReversalSource(tx, request.sourceDocumentId, request.requestPayload);
    if (original.sourceKind === "YEAR_CLOSE") throw new HttpError(409, "A fiscal closing journal requires the annual reopening workflow.");
    await validateMatchedBankReversal(tx, original.id);
    if (request.originalJournalId !== original.id) throw new HttpError(409, "Reversal approval source mismatch.");
    await validateAparReversal(tx, original.id, new Date(payload.accountingDate));
    await validateStage23Reversal(tx, original.id, new Date(payload.accountingDate));
    await validateAssetReversal(tx, original.id, new Date(payload.accountingDate));
    await validateFundReversal(tx, original.id, new Date(payload.accountingDate));
    reversalOriginalId = original.id;
    currentDigest = digest;
    expected = { journalType: "REVERSAL", sourceKind: "REVERSAL", sourceReference: original.id,
      accountingDate: new Date(`${payload.accountingDate}T00:00:00.000Z`), postedById: input.postedById,
      descriptionSnapshot: `Reversal of ${original.journalNumber}`,
      relatedJournalId: original.id, reversalOfJournalId: original.id,
      lines: original.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) };
  }
  assertAccountingApprovalForPosting({ request: approvalEvidence(request), kind,
    sourceDocumentId: request.sourceDocumentId, sourceVersion: request.sourceVersion, currentDigest,
    hasPostingPermission: await hasAccountingPermission(tx, input.postedById, ACCOUNTING_POST) });
  if (!request.decidedById || !await hasAccountingPermission(tx, request.decidedById, ACCOUNTING_APPROVE)) {
    throw new HttpError(409, "Accounting approver is no longer active or authorized; obtain a new approval.");
  }
  if (accountingApprovalDigest(postingMaterial(input)) !== accountingApprovalDigest(postingMaterial(expected))) {
    throw new HttpError(409, "Proposed journal does not match the approved document.");
  }
  return { request, draftId, aparPlan, schedulePlan, assetPlan, fundPlan, finalPlan, reversalOriginalId };
}

export async function applyJournalApproval(tx: Prisma.TransactionClient,
  verified: NonNullable<Awaited<ReturnType<typeof verifyJournalApproval>>>, journalId: string, actorId: string) {
  const now = new Date();
  const changed = await tx.accountingApprovalRequest.updateMany({ where: { id: verified.request.id,
    status: "APPROVED", sourceDigest: verified.request.sourceDigest }, data: { status: "APPLIED",
    appliedAt: now, appliedById: actorId, appliedJournalId: journalId } });
  if (changed.count !== 1) throw new HttpError(409, "Accounting approval has already been applied or invalidated.");
  if (verified.draftId) {
    const draft = await tx.accountingJournalDraft.updateMany({ where: { id: verified.draftId,
      status: "DRAFT", revision: verified.request.sourceVersion }, data: { status: "POSTED", postedJournalId: journalId } });
    if (draft.count !== 1) throw new HttpError(409, "Accounting draft changed before posting.");
  }
  if (verified.aparPlan) await applyAparPosting(tx, verified.aparPlan, journalId, actorId, verified.request.requestedById);
  if (verified.schedulePlan) await applyStage23Posting(tx, verified.schedulePlan, journalId);
  if (verified.assetPlan) await applyAssetPosting(tx, verified.assetPlan, journalId, actorId);
  if (verified.fundPlan) await applyFundPosting(tx, verified.fundPlan, journalId, actorId);
  if (verified.finalPlan) await applyFinalPosting(tx, verified.finalPlan, journalId, actorId);
  if (verified.reversalOriginalId) await applyAparReversal(tx, verified.reversalOriginalId, actorId);
  if (verified.reversalOriginalId) await applyStage23Reversal(tx, verified.reversalOriginalId);
  if (verified.reversalOriginalId) await applyAssetReversal(tx, verified.reversalOriginalId, actorId);
  if (verified.reversalOriginalId) await applyFundReversal(tx, verified.reversalOriginalId, actorId);
  await appendApprovalHistory(tx, { approvalRequestId: verified.request.id, action: "APPLY",
    statusBefore: "APPROVED", statusAfter: "APPLIED", actorId, actionAt: now,
    sourceDigest: verified.request.sourceDigest });
}
