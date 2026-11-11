import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { accountingCents, accountingCutoverDate } from "../accounting.domain.js";
import { centsToDecimal } from "../../../lib/money.js";
import { aparTransaction } from "../apar/apar.repository.js";
import { ACCOUNTING_MANAGE, requireAccountingPermission } from "../approval/approval.repository.js";
import { invalidateRequests } from "../approval/approval.service.js";
import { assetInclude, assetState, claimSource, loadAsset, loadRun, policyOf, requireCategory } from "./asset.repository.js";
import { assetPolicySchema, type AssetInput, type CategoryInput, type RunInput } from "./asset.schema.js";
import { day, dateText, depreciationStart } from "./asset.domain.js";
import { configuredRunPeriod, depreciationQuote } from "./depreciation.service.js";
export function createCategory(actorId: string, input: CategoryInput) {
  return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
    const row = await tx.accountingAssetCategory.create({ data: { ...input, policy: input.policy ?? Prisma.DbNull } });
    await requireCategory(tx, row.id, false); return row;
  });
}
export function updateCategory(actorId: string, id: string, revision: number, input: CategoryInput) {
  return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
    if (await tx.accountingFixedAsset.count({ where: { assetCategoryId: id } })) throw new HttpError(409, "A used category is immutable; create a new reviewed category and reclassify assets.");
    const historical = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM arya_accounting_approval_request
      WHERE request_kind IN ('ASSET_ACTIVATE','ASSET_CHANGE','ASSET_JOURNAL','DEPRECIATION_RUN') AND JSON_SEARCH(request_payload,'one',${id}) IS NOT NULL`;
    if (Number(historical[0]?.n ?? 0) > 0) throw new HttpError(409, "A category referenced by review/history is immutable; use a new category.");
    const changed = await tx.accountingAssetCategory.updateMany({ where: { id, revision }, data: { ...input, policy: input.policy ?? Prisma.DbNull, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new HttpError(409, "Category revision changed."); return requireCategory(tx, id, false);
  });
}
async function sourceAssetData(tx: Prisma.TransactionClient, input: AssetInput, actorId: string, id?: string) {
  const category = await requireCategory(tx, input.assetCategoryId), source = await claimSource(tx, input.acquisitionJournalLineId, id);
  if (source.accountId !== category.assetAccountId || accountingCents(source.debit) <= 0n || accountingCents(source.credit) !== 0n
    || !["AP_DOCUMENT", "MANUAL_JOURNAL"].includes(source.journal.sourceKind ?? "")) throw new HttpError(409, "Acquisition needs an actual approved AP/manual asset debit; never capitalize it a second time.");
  const document = await tx.accountingDocument.findUnique({ where: { recognitionJournalId: source.journalId } });
  if (document && document.documentKind !== "PAYABLE") throw new HttpError(409, "Asset acquisition source must be payable or separately approved manual acquisition.");
  const acquired = day(input.acquiredOn), available = day(input.inServiceOn), start = day(input.depreciationStartOn);
  if (acquired > available || accountingCents(input.residualValue) > accountingCents(source.debit)) throw new HttpError(400, "Acquisition dates or residual value are invalid.");
  if (input.custodianId && !await tx.user.findFirst({ where: { id: input.custodianId, status: "ACTIVE" } })) throw new HttpError(409, "Custodian must be an active user.");
  const policy = assetPolicySchema.safeParse(category.policy);
  if (policy.success && dateText(depreciationStart(available, policy.data.partialMonthPolicy)) !== input.depreciationStartOn) throw new HttpError(400, "Depreciation start must follow the explicitly selected partial-month policy.");
  return { assetNumber: input.assetNumber, assetName: input.assetName, description: input.description, location: input.location,
    assetCategoryId: category.id, acquisitionJournalLineId: source.id, sourceDocumentId: document?.id ?? null,
    vendorId: document?.counterpartyId ?? source.counterpartyId, custodianId: input.custodianId, acquiredOn: acquired, inServiceOn: available,
    depreciationStartOn: start, acquisitionCost: source.debit, residualValue: input.residualValue, usefulLifeMonths: input.usefulLifeMonths,
    depreciationMethod: "STRAIGHT_LINE", eventCampaignId: source.eventCampaignId, updatedById: actorId,
    policySnapshot: { ...(policy.success ? policy.data : {}), supportingEvidence: input.supportingEvidence } };
}
export function createAsset(actorId: string, input: AssetInput) {
  return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
    return tx.accountingFixedAsset.create({ data: { ...await sourceAssetData(tx, input, actorId), createdById: actorId, status: "DRAFT" } });
  });
}
export function reviseAsset(actorId: string, id: string, revision: number, input: AssetInput) {
  return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE); const asset = await loadAsset(tx, id, true);
    if (asset.createdById !== actorId || !["DRAFT", "CANCELLED"].includes(asset.status) || asset.revision !== revision) throw new HttpError(409, "Only the creator may revise the current unactivated asset.");
    const data = await sourceAssetData(tx, input, actorId, id);
    await invalidateRequests(tx, id, actorId);
    return tx.accountingFixedAsset.update({ where: { id }, data: { ...data, status: "DRAFT", revision: { increment: 1 } } });
  });
}
export async function validateActivation(tx: Prisma.TransactionClient, id: string) {
  const asset = await loadAsset(tx, id, true), category = await requireCategory(tx, asset.assetCategoryId), policy = policyOf(asset);
  await claimSource(tx, asset.acquisitionJournalLineId, id);
  if (asset.status !== "DRAFT" || asset.depreciationMethod !== "STRAIGHT_LINE"
    || accountingCents(asset.acquisitionCost) !== accountingCents(asset.relFkAccFixedAssetSource.debit)
    || accountingCents(asset.acquisitionCost) < accountingCents(policy.capitalizationThreshold)
    || dateText(depreciationStart(asset.inServiceOn, policy.partialMonthPolicy)) !== dateText(asset.depreciationStartOn)
    || asset.relFkAccFixedAssetSource.accountId !== category.assetAccountId || asset.depreciationStartOn < accountingCutoverDate()) {
    throw new HttpError(409, "Asset activation requires reviewed capitalization threshold, source, start policy and cutover validation.");
  }
  return asset;
}
export function getAsset(actorId: string, id: string) {
  return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, "ACCOUNTING_REPORT"); const asset = await loadAsset(tx, id), state = assetState(asset);
    const [approvals, payments] = await Promise.all([tx.accountingApprovalRequest.findMany({ where: { OR: [{ fixedAssetId: id }, { journalDraft: { is: { fixedAssetId: id } } }] }, include: { history: true }, orderBy: { requestedAt: "asc" }, take: 500 }),
      asset.sourceDocumentId ? tx.accountingSettlementAllocation.findMany({ where: { accountingDocumentId: asset.sourceDocumentId }, include: { relFkAccAllocationSettlement: true }, take: 500 }) : []]);
    return { ...asset, grossCost: centsToDecimal(state.gross), accumulatedDepreciation: centsToDecimal(state.accumulated), impairment: centsToDecimal(state.impairment),
      carryingAmount: centsToDecimal(state.disposed ? 0n : state.carrying), depreciationState: state.disposed ? "STOPPED_DISPOSAL" : asset.status !== "ACTIVE" ? "NOT_AUTHORIZED" : state.carrying <= accountingCents(asset.residualValue) ? "FULLY_DEPRECIATED" : "DEPRECIABLE",
      policyStatus: assetPolicySchema.passthrough().safeParse(asset.policySnapshot).success ? (["ACTIVE", "DISPOSED", "WRITTEN_OFF"].includes(asset.status) ? "REVIEWED" : "PROVIDED_FOR_REVIEW") : "PENDING_POLICY",
      approvalHistory: approvals, payments, relatedLimit: 500 };
  });
}
export async function previewRunInTransaction(tx: Prisma.TransactionClient, input: RunInput) {
  const period = await configuredRunPeriod(tx, input.accountingPeriodId);
  const assets = await tx.accountingFixedAsset.findMany({ where: { id: { in: input.assetIds } }, include: assetInclude, orderBy: { id: "asc" } });
  if (assets.length !== input.assetIds.length) throw new HttpError(404, "Some selected assets were not found.");
  const rows = assets.map(asset => ({ assetId: asset.id, ...depreciationQuote(asset, period) }));
  return { period, rows, postingAutomatic: false };
}
export function previewRun(actorId: string, input: RunInput) { return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE); return previewRunInTransaction(tx, input); }); }
export function createRun(actorId: string, input: RunInput) {
  return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
    const preview = await previewRunInTransaction(tx, input), rows = preview.rows.filter(r => accountingCents(r.amount) > 0n);
    if (!rows.length) throw new HttpError(409, "No selected asset has due positive depreciation.");
    const run = await tx.accountingDepreciationRun.create({ data: { runReference: input.runReference, accountingPeriodId: preview.period.id,
      runDate: preview.period.endDate, createdById: actorId, revFkAccDepRunAssetRun: { create: rows.map(row => ({ fixedAssetId: row.assetId,
        plannedAmount: row.amount, accountingPeriodId: preview.period.id, activePeriodId: preview.period.id, assetSnapshot: row.snapshot })) } } });
    return loadRun(tx, run.id);
  });
}
export function refreshRun(actorId: string, id: string, revision: number) {
  return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE); const run = await loadRun(tx, id);
    if (run.createdById !== actorId || run.status !== "DRAFT" || run.revision !== revision) throw new HttpError(409, "Only the owner may refresh an unposted run.");
    const quote = await previewRunInTransaction(tx, { runReference: run.runReference, accountingPeriodId: run.accountingPeriodId, assetIds: run.revFkAccDepRunAssetRun.map(r => r.fixedAssetId) });
    if (quote.rows.some(r => accountingCents(r.amount) <= 0n)) throw new HttpError(409, "Cancel and rebuild the run after changes to eligible assets.");
    await tx.$executeRaw(Prisma.sql`UPDATE arya_accounting_depreciation_run_asset SET
      planned_amount=CASE fixed_asset_id ${Prisma.join(quote.rows.map(r => Prisma.sql`WHEN ${r.assetId} THEN CAST(${r.amount} AS DECIMAL(20,2))`), " ")} END,
      asset_snapshot=CASE fixed_asset_id ${Prisma.join(quote.rows.map(r => Prisma.sql`WHEN ${r.assetId} THEN CAST(${JSON.stringify(r.snapshot)} AS JSON)`), " ")} END
      WHERE depreciation_run_id=${id}`);
    await invalidateRequests(tx, id, actorId); return tx.accountingDepreciationRun.update({ where: { id }, data: { revision: { increment: 1 } } });
  });
}
