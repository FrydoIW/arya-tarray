import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { accountingCents } from "../accounting.domain.js";
import { centsToDecimal } from "../../../lib/money.js";
import { aparTransaction } from "../apar/apar.repository.js";
import { ACCOUNTING_MANAGE, requireAccountingPermission } from "../approval/approval.repository.js";
import { invalidateRequests } from "../approval/approval.service.js";
import { assetState, claimSource, loadAsset, policyOf, requireCategory, type AssetRecord } from "./asset.repository.js";
import { assetChangeSchema, type AssetChange } from "./asset.schema.js";
import { day, dateText, monthStart, straightLinePortion, disposalAmounts } from "./asset.domain.js";
import type { LedgerLineInput } from "../ledger/ledger.domain.js";
export const isNonfinancialChange = (action: string) => ["ESTIMATE", "ADDITIONAL", "CORRECTION", "DEACTIVATE"].includes(action);
export async function loadAssetChange(tx: Prisma.TransactionClient, id: string) {
  const draft = await tx.accountingJournalDraft.findUnique({ where: { id } });
  if (!draft?.fixedAssetId || !["ASSET_CHANGE", "ASSET_JOURNAL"].includes(draft.sourceKind)) throw new HttpError(404, "Asset change was not found.");
  return { draft, command: assetChangeSchema.parse(draft.assetMetadata), asset: await loadAsset(tx, draft.fixedAssetId, true) };
}
function requirePriorDepreciation(asset: AssetRecord, effective: Date) {
  const policy = policyOf(asset), state = assetState(asset), epoch = asset.depreciationStartOn;
  const before = assetState(asset, new Date(epoch.getTime() - 86400000)), at = assetState(asset, epoch);
  const late = asset.relFkAccFixedAssetSource.journal.accountingDate > epoch ? accountingCents(asset.relFkAccFixedAssetSource.debit) : 0n;
  const basis = at.gross + late - before.accumulated - at.impairment - accountingCents(asset.residualValue);
  const previousEnd = new Date(monthStart(effective).getTime() - 86400000), previousStart = monthStart(previousEnd);
  const due = straightLinePortion(basis, epoch, asset.usefulLifeMonths, policy.partialMonthPolicy, previousStart, previousEnd);
  if (assetState(asset, previousEnd).accumulated - before.accumulated !== due.expectedBefore + due.amount) throw new HttpError(409, "Post/review all earlier due depreciation before changing the asset plan.");
}
export async function prepareAssetChange(tx: Prisma.TransactionClient, id: string) {
  const context = await loadAssetChange(tx, id), { asset, command, draft } = context, state = assetState(asset), category = await requireCategory(tx, asset.assetCategoryId), policy = policyOf(asset);
  if (draft.status !== "DRAFT" || asset.status !== "ACTIVE" || state.disposed || day(command.effectiveDate) < state.latest) throw new HttpError(409, "Asset change requires an active asset and chronological unposted evidence.");
  if (command.action === "IMPAIRMENT_REVERSAL") throw new HttpError(409, "PENDING POLICY: valuation impairment reversal needs an adopted framework and tested recovery ceiling; no amount is inferred.");
  requirePriorDepreciation(asset, day(command.effectiveDate));
  const source = draft.assetSourceLineId ? await claimSource(tx, draft.assetSourceLineId, asset.id, id) : null;
  const costSource = draft.assetCostLineId ? await claimSource(tx, draft.assetCostLineId, asset.id, id) : null;
  const lines: LedgerLineInput[] = [], dimensions = { accountingFundId: asset.relFkAccFixedAssetSource.accountingFundId,
    fundRestrictionId: asset.relFkAccFixedAssetSource.fundRestrictionId, counterpartyId: asset.vendorId, eventCampaignId: asset.eventCampaignId };
  const put = (accountId: string | null, debit: bigint, credit: bigint) => {
    if (debit === 0n && credit === 0n) return;
    if (!accountId) throw new HttpError(409, "PENDING POLICY: required disposal or impairment account mapping is absent.");
    lines.push({ accountId, debit: centsToDecimal(debit), credit: centsToDecimal(credit), ...dimensions });
  };
  let extra = 0n;
  if (command.action === "ADDITIONAL") {
    if (!source || source.id === asset.acquisitionJournalLineId || source.accountId !== category.assetAccountId || accountingCents(source.debit) <= 0n
      || !["AP_DOCUMENT", "MANUAL_JOURNAL"].includes(source.journal.sourceKind ?? "")
      || source.journal.accountingDate > day(command.effectiveDate)) throw new HttpError(409, "Additional capital cost requires a distinct actual asset debit posted no later than its effective date.");
    extra = accountingCents(source.debit);
  }
  if (["ESTIMATE", "ADDITIONAL", "IMPAIRMENT"].includes(command.action)) {
    if (!command.effectiveDate.endsWith("-01")) throw new HttpError(409, "Prospective depreciation changes require an explicit first-of-month effective date.");
    if ("residualValue" in command && accountingCents(command.residualValue) > state.carrying + extra) throw new HttpError(409, "Residual exceeds the supported carrying amount.");
  }
  if (command.action === "CORRECTION") {
    if (command.acquiredOn && day(command.acquiredOn) > asset.inServiceOn) throw new HttpError(400, "Corrected acquisition date cannot follow available-for-use date.");
    if (command.custodianId && !await tx.user.findFirst({ where: { id: command.custodianId, status: "ACTIVE" } })) throw new HttpError(409, "Custodian is unavailable.");
  }
  if (command.action === "DEACTIVATE" && (state.accumulated !== 0n || state.impairment !== 0n || asset.changes.some(d => ["POSTED", "APPLIED"].includes(d.status)))) throw new HttpError(409, "An asset with accounting activity cannot be deactivated; resolve its dependencies first.");
  if (command.action === "RECLASSIFY") {
    const next = await requireCategory(tx, command.categoryId);
    if (next.id === category.id) throw new HttpError(400, "Select a different asset category.");
    put(next.assetAccountId, state.gross, 0n); put(category.assetAccountId, 0n, state.gross);
    put(category.accumulatedDepreciationAccountId, state.accumulated, 0n); put(next.accumulatedDepreciationAccountId, 0n, state.accumulated);
    put(category.impairmentAllowanceAccountId, state.impairment, 0n); put(next.impairmentAllowanceAccountId, 0n, state.impairment);
  }
  if (command.action === "IMPAIRMENT") {
    if (!policy.impairmentEnabled || !policy.impairmentPolicyReference) throw new HttpError(409, "PENDING POLICY: adopted impairment policy and explicit assessment are required.");
    const recoverable = accountingCents(command.recoverableAmount), loss = state.carrying - recoverable;
    if (loss <= 0n || accountingCents(command.residualValue) > recoverable) throw new HttpError(400, "Assessment must support a positive impairment and valid future residual.");
    put(category.impairmentExpenseAccountId, loss, 0n); put(category.impairmentAllowanceAccountId, 0n, loss);
  }
  let disposal: ReturnType<typeof disposalAmounts> | null = null;
  if (command.action === "DISPOSE" || command.action === "WRITE_OFF") {
    const proceeds = command.action === "DISPOSE" ? command.proceeds : "0.00", money = accountingCents(proceeds);
    if (money > 0n) {
      if (!source || source.accountId !== category.disposalClearingAccountId || accountingCents(source.credit) !== money || source.journal.accountingDate > day(command.effectiveDate)) throw new HttpError(409, "Sale needs exact actual consideration in the configured disposal clearing account.");
      const receivable = await tx.accountingDocument.findUnique({ where: { recognitionJournalId: source.journalId } });
      const bankDebit = source.journal.lines.some(l => l.bankAccountId && l.account.accountType === "ASSET" && accountingCents(l.debit) > 0n);
      if (!(receivable?.documentKind === "RECEIVABLE") && !(bankDebit && source.journal.sourceKind === "MANUAL_JOURNAL")) throw new HttpError(409, "Unreceived proceeds need an actual AR document; cash proceeds need approved actual bank evidence.");
      put(category.disposalClearingAccountId, money, 0n);
    } else if (source) throw new HttpError(400, "A zero-proceeds disposal cannot claim consideration evidence.");
    let costs = 0n;
    if (costSource) {
      if (costSource.accountId !== category.lossAccountId || accountingCents(costSource.debit) <= 0n || costSource.journal.accountingDate > day(command.effectiveDate)
        || !["AP_DOCUMENT", "MANUAL_JOURNAL"].includes(costSource.journal.sourceKind ?? "")) throw new HttpError(409, "Disposal costs require actual recorded loss/expense evidence.");
      costs = accountingCents(costSource.debit); put(category.lossAccountId, 0n, costs);
    }
    disposal = disposalAmounts(centsToDecimal(state.gross), centsToDecimal(state.accumulated), centsToDecimal(state.impairment), proceeds, centsToDecimal(costs));
    put(category.accumulatedDepreciationAccountId, state.accumulated, 0n); put(category.impairmentAllowanceAccountId, state.impairment, 0n);
    put(category.assetAccountId, 0n, state.gross); put(category.gainAccountId, 0n, accountingCents(disposal.gain)); put(category.lossAccountId, accountingCents(disposal.loss), 0n);
  }
  return { ...context, state, category, policy, source, costSource, lines, extra, disposal };
}
export function createAssetChange(actorId: string, assetId: string, command: AssetChange) {
  return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE); await loadAsset(tx, assetId, true);
    const sourceId = command.action === "ADDITIONAL" ? command.sourceJournalLineId : command.action === "DISPOSE" ? command.considerationJournalLineId : null;
    const costId = command.action === "DISPOSE" ? command.costJournalLineId : null;
    if (sourceId) await claimSource(tx, sourceId, assetId); if (costId) await claimSource(tx, costId, assetId);
    const id = randomUUID(), draft = await tx.accountingJournalDraft.create({ data: { id, draftNumber: `ASSET-${id}`, sourceReference: id,
      journalType: "ADJUSTMENT", sourceKind: isNonfinancialChange(command.action) ? "ASSET_CHANGE" : "ASSET_JOURNAL", fixedAssetId: assetId,
      assetMetadata: command, assetSourceLineId: sourceId, assetCostLineId: costId, accountingDate: day(command.effectiveDate), description: command.reason, createdById: actorId } });
    try { await prepareAssetChange(tx, id); return { ...draft, policyStatus: "READY_FOR_INDEPENDENT_REVIEW" }; }
    catch (error) { if (error instanceof HttpError && error.message.startsWith("PENDING POLICY:")) return { ...draft, policyStatus: "PENDING_POLICY", policyReason: error.message }; throw error; }
  });
}
export function refreshAssetChange(actorId: string, id: string, revision: number) {
  return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE); const { draft } = await loadAssetChange(tx, id);
    if (draft.createdById !== actorId || draft.status !== "DRAFT" || draft.revision !== revision) throw new HttpError(409, "Only the owner may refresh an unposted change.");
    await prepareAssetChange(tx, id); await invalidateRequests(tx, id, actorId);
    return tx.accountingJournalDraft.update({ where: { id }, data: { revision: { increment: 1 } } });
  });
}
