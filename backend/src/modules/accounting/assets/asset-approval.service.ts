import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { accountingApprovalDigest, assertAccountingApprovalForPosting } from "../approval/approval.domain.js";
import { ACCOUNTING_APPROVE, ACCOUNTING_POST, appendApprovalHistory, approvalEvidence, hasAccountingPermission, loadApproval } from "../approval/approval.repository.js";
import { assetMaterial, assetState, loadAsset, loadRun } from "./asset.repository.js";
import { isNonfinancialChange, loadAssetChange, prepareAssetChange } from "./asset-change.service.js";
import { configuredRunPeriod, depreciationQuote } from "./depreciation.service.js";
import { validateActivation } from "./asset.service.js";
import { day, dateText } from "./asset.domain.js";
import { centsToDecimal } from "../../../lib/money.js";
import type { LedgerJournalInput } from "../ledger/ledger.service.js";
export const isAssetKind = (kind: string) => ["ASSET_ACTIVATE", "ASSET_CHANGE", "ASSET_JOURNAL", "DEPRECIATION_RUN"].includes(kind);
type Source = { id?: string; requestKind: string; sourceDocumentId: string };
export async function assetIdentity(tx: Prisma.TransactionClient, request: Source) {
  if (request.requestKind === "ASSET_ACTIVATE") {
    const asset = await loadAsset(tx, request.sourceDocumentId);
    const material = assetMaterial(asset); return { material, sourceDigest: accountingApprovalDigest(material), sourceVersion: asset.revision,
      requesterId: asset.createdById, accountingDate: asset.relFkAccFixedAssetSource.journal.accountingDate, sourceLink: { fixedAssetId: asset.id } };
  }
  if (request.requestKind === "DEPRECIATION_RUN") {
    const run = await loadRun(tx, request.sourceDocumentId);
    const material = { id: run.id, reference: run.runReference, period: run.accountingPeriodId, date: dateText(run.runDate), revision: String(run.revision), status: run.status,
      assets: run.revFkAccDepRunAssetRun.map(row => ({ id: row.fixedAssetId, amount: row.plannedAmount.toFixed(2), snapshot: row.assetSnapshot, current: assetMaterial(row.relFkAccDepRunAssetAsset) })) };
    return { material, sourceDigest: accountingApprovalDigest(material), sourceVersion: run.revision, requesterId: run.createdById,
      accountingDate: run.runDate, sourceLink: { depreciationRunId: run.id } };
  }
  const { draft, command, asset } = await loadAssetChange(tx, request.sourceDocumentId);
  if (draft.sourceKind !== request.requestKind) throw new HttpError(409, "Asset change approval kind mismatch.");
  const target = command.action === "RECLASSIFY" ? await tx.accountingAssetCategory.findUnique({ where: { id: command.categoryId } }) : null;
  const sources = await tx.accountingJournalLine.findMany({ where: { id: { in: [draft.assetSourceLineId, draft.assetCostLineId].flatMap(id => id ? [id] : []) } }, orderBy: { id: "asc" }, select: { id: true, accountId: true, debit: true, credit: true, journalId: true } });
  const normalizedCommand = { ...command, ...("remainingLifeMonths" in command ? { remainingLifeMonths: String(command.remainingLifeMonths) } : {}) };
  const material = { id: draft.id, revision: String(draft.revision), status: draft.status, command: normalizedCommand, asset: assetMaterial(asset), source: draft.assetSourceLineId, costSource: draft.assetCostLineId,
    sourceEvidence: sources.map(s => ({ id: s.id, account: s.accountId, debit: s.debit.toFixed(2), credit: s.credit.toFixed(2), journal: s.journalId })),
    targetCategory: target ? { id: target.id, revision: String(target.revision), policy: target.policy, asset: target.assetAccountId, accumulated: target.accumulatedDepreciationAccountId,
      expense: target.depreciationExpenseAccountId, impairment: target.impairmentAllowanceAccountId, active: target.activeFlag } : null };
  return { material, sourceDigest: accountingApprovalDigest(material), sourceVersion: draft.revision, requesterId: draft.createdById,
    accountingDate: draft.accountingDate, sourceLink: { journalDraftId: draft.id } };
}
export async function validateAssetRun(tx: Prisma.TransactionClient, id: string) {
  const run = await loadRun(tx, id);
  if (run.status !== "DRAFT" || !run.revFkAccDepRunAssetRun.length || run.revFkAccDepRunAssetRun.length > 200) throw new HttpError(409, "Only a populated unposted bounded depreciation run can post.");
  const period = await configuredRunPeriod(tx, run.accountingPeriodId);
  if (run.runDate.getTime() !== period.endDate.getTime()) throw new HttpError(409, "Run date must be the selected period end.");
  for (const row of run.revFkAccDepRunAssetRun) {
    const quote = depreciationQuote(row.relFkAccDepRunAssetAsset, period);
    if (row.activePeriodId !== period.id || row.accountingPeriodId !== period.id || row.plannedAmount.toFixed(2) !== quote.amount
      || accountingApprovalDigest(row.assetSnapshot) !== accountingApprovalDigest(quote.snapshot)) throw new HttpError(409, "Depreciation preview is stale; refresh and independently approve its new version.");
  }
  return run;
}
export async function validateAssetRequest(tx: Prisma.TransactionClient, request: Source) {
  if (request.requestKind === "ASSET_ACTIVATE") return validateActivation(tx, request.sourceDocumentId);
  if (request.requestKind === "DEPRECIATION_RUN") return validateAssetRun(tx, request.sourceDocumentId);
  return prepareAssetChange(tx, request.sourceDocumentId);
}
export type AssetPostingPlan = { expected: LedgerJournalInput; runId?: string; changeId?: string };
export async function prepareAssetPosting(tx: Prisma.TransactionClient, request: Source, actorId: string): Promise<AssetPostingPlan> {
  if (request.requestKind === "DEPRECIATION_RUN") {
    const run = await validateAssetRun(tx, request.sourceDocumentId);
    return { runId: run.id, expected: { approvalRequestId: request.id, journalType: "DEPRECIATION", sourceKind: "DEPRECIATION_RUN", sourceReference: run.id,
      accountingDate: run.runDate, postedById: actorId, descriptionSnapshot: `Depreciation ${run.runReference}`,
      lines: run.revFkAccDepRunAssetRun.flatMap(row => { const asset = row.relFkAccDepRunAssetAsset, c = asset.relFkAccFixedAssetCat, source = asset.relFkAccFixedAssetSource;
        const dims = { accountingFundId: source.accountingFundId, fundRestrictionId: source.fundRestrictionId, counterpartyId: asset.vendorId, eventCampaignId: asset.eventCampaignId };
        return [{ accountId: c.depreciationExpenseAccountId, debit: row.plannedAmount.toFixed(2), credit: "0.00", ...dims },
          { accountId: c.accumulatedDepreciationAccountId, debit: "0.00", credit: row.plannedAmount.toFixed(2), ...dims }]; }) } };
  }
  const prepared = await prepareAssetChange(tx, request.sourceDocumentId);
  if (isNonfinancialChange(prepared.command.action)) throw new HttpError(409, "Nonfinancial asset changes must not create a duplicate journal.");
  return { changeId: prepared.draft.id, expected: { approvalRequestId: request.id, journalType: "ADJUSTMENT", sourceKind: "ASSET_JOURNAL",
    sourceReference: prepared.draft.id, accountingDate: prepared.draft.accountingDate, postedById: actorId,
    descriptionSnapshot: prepared.command.reason, relatedJournalId: prepared.asset.relFkAccFixedAssetSource.journalId, lines: prepared.lines } };
}
export async function applyAssetPosting(tx: Prisma.TransactionClient, plan: AssetPostingPlan, journalId: string, actorId: string) {
  if (plan.runId) {
    const run = await loadRun(tx, plan.runId), lines = await tx.accountingJournalLine.findMany({ where: { journalId }, orderBy: { lineNo: "asc" } });
    const mappings = run.revFkAccDepRunAssetRun.map((row, i) => { const expense = lines[i * 2], accumulated = lines[i * 2 + 1];
      if (!expense || !accumulated) throw new HttpError(409, "Posted depreciation line mapping is incomplete."); return { id: row.id, expense: expense.id, accumulated: accumulated.id }; });
    await tx.$executeRaw(Prisma.sql`UPDATE arya_accounting_depreciation_run_asset SET
      expense_journal_line_id=CASE depreciation_run_asset_id ${Prisma.join(mappings.map(m => Prisma.sql`WHEN ${m.id} THEN ${m.expense}`), " ")} END,
      accumulated_journal_line_id=CASE depreciation_run_asset_id ${Prisma.join(mappings.map(m => Prisma.sql`WHEN ${m.id} THEN ${m.accumulated}`), " ")} END
      WHERE depreciation_run_id=${run.id}`);
    const changed = await tx.accountingDepreciationRun.updateMany({ where: { id: run.id, status: "DRAFT" }, data: { status: "POSTED", postingJournalId: journalId } });
    if (changed.count !== 1) throw new HttpError(409, "Run already posted or changed.");
  }
  if (plan.changeId) {
    const { asset, command } = await loadAssetChange(tx, plan.changeId);
    const data: Prisma.AccountingFixedAssetUncheckedUpdateInput = { revision: { increment: 1 }, updatedById: actorId };
    if (command.action === "RECLASSIFY") data.assetCategoryId = command.categoryId;
    if (command.action === "IMPAIRMENT") { data.depreciationStartOn = day(command.effectiveDate); data.usefulLifeMonths = command.remainingLifeMonths; data.residualValue = command.residualValue; }
    if (command.action === "DISPOSE" || command.action === "WRITE_OFF") {
      data.status = command.action === "WRITE_OFF" ? "WRITTEN_OFF" : "DISPOSED"; data.disposedOn = day(command.effectiveDate); data.disposalJournalId = journalId;
    }
    await tx.accountingFixedAsset.update({ where: { id: asset.id }, data });
  }
}
export async function applyAssetCommand(tx: Prisma.TransactionClient, actorId: string, id: string) {
  const request = await loadApproval(tx, id), identity = await assetIdentity(tx, request), evidence = approvalEvidence(request);
  if (request.status === "APPLIED" && request.requestKind === "ASSET_ACTIVATE") {
    if (!await hasAccountingPermission(tx, actorId, ACCOUNTING_POST)) throw new HttpError(403, "Posting permission required.");
    return { assetId: request.sourceDocumentId, alreadyApplied: true, financialJournalCreated: false };
  }
  assertAccountingApprovalForPosting({ request: evidence, kind: evidence.kind, sourceDocumentId: request.sourceDocumentId,
    sourceVersion: identity.sourceVersion, currentDigest: identity.sourceDigest, hasPostingPermission: await hasAccountingPermission(tx, actorId, ACCOUNTING_POST) });
  if (!request.decidedById || !await hasAccountingPermission(tx, request.decidedById, ACCOUNTING_APPROVE)) throw new HttpError(409, "Asset approver is no longer authorized.");
  if (request.requestKind === "ASSET_ACTIVATE") {
    const asset = await validateActivation(tx, request.sourceDocumentId);
    await tx.accountingFixedAsset.update({ where: { id: asset.id }, data: { status: "ACTIVE", updatedById: actorId } });
  } else {
    const plan = await prepareAssetChange(tx, request.sourceDocumentId), { asset, command, state } = plan;
    if (!isNonfinancialChange(command.action)) throw new HttpError(409, "Financial changes require the common ledger.");
    const data: Prisma.AccountingFixedAssetUncheckedUpdateInput = { revision: { increment: 1 }, updatedById: actorId };
    if (command.action === "ESTIMATE" || command.action === "ADDITIONAL") {
      data.usefulLifeMonths = command.remainingLifeMonths; data.residualValue = command.residualValue; data.depreciationStartOn = day(command.effectiveDate);
      if (command.action === "ADDITIONAL") data.acquisitionCost = centsToDecimal(state.gross + plan.extra);
    }
    if (command.action === "CORRECTION") {
      if (command.assetName !== undefined) data.assetName = command.assetName;
      if (command.description !== undefined) data.description = command.description;
      if (command.location !== undefined) data.location = command.location;
      if (command.acquiredOn !== undefined) data.acquiredOn = day(command.acquiredOn);
      if (command.custodianId !== undefined) data.custodianId = command.custodianId;
    }
    if (command.action === "DEACTIVATE") data.status = "DRAFT";
    await tx.accountingFixedAsset.update({ where: { id: asset.id }, data });
    await tx.accountingJournalDraft.update({ where: { id: plan.draft.id }, data: { status: "APPLIED" } });
  }
  const now = new Date(), changed = await tx.accountingApprovalRequest.updateMany({ where: { id, status: "APPROVED", sourceDigest: request.sourceDigest }, data: { status: "APPLIED", appliedById: actorId, appliedAt: now } });
  if (changed.count !== 1) throw new HttpError(409, "Asset action changed or already applied.");
  await appendApprovalHistory(tx, { approvalRequestId: id, actorId, action: "APPLY", statusBefore: "APPROVED", statusAfter: "APPLIED", sourceDigest: request.sourceDigest, actionAt: now });
  return { approvalRequestId: id, action: request.requestKind, financialJournalCreated: false };
}
