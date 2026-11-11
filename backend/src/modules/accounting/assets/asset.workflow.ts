import { HttpError } from "../../../lib/http.js";
import { centsToDecimal } from "../../../lib/money.js";
import { accountingTotalCents } from "../accounting.domain.js";
import { aparTransaction } from "../apar/apar.repository.js";
import { ACCOUNTING_MANAGE, appendApprovalHistory, loadApproval, requireAccountingPermission } from "../approval/approval.repository.js";
import { applyApprovedAction, submitApproval } from "../approval/approval.service.js";
import { assetIdentity, isAssetKind } from "./asset-approval.service.js";
import { loadAsset, loadRun } from "./asset.repository.js";
import { loadAssetChange } from "./asset-change.service.js";
import { loadAssetControlTotals } from "./asset-reconciliation.repository.js";
export async function submitAssetSource(actorId: string, type: "ASSET" | "RUN" | "CHANGE", id: string, expectedRevision: number) {
  let kind: "ASSET_ACTIVATE" | "DEPRECIATION_RUN" | "ASSET_CHANGE" | "ASSET_JOURNAL" = type === "ASSET" ? "ASSET_ACTIVATE" : "DEPRECIATION_RUN";
  if (type === "CHANGE") kind = await aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
    return (await loadAssetChange(tx, id)).draft.sourceKind === "ASSET_CHANGE" ? "ASSET_CHANGE" : "ASSET_JOURNAL"; });
  return submitApproval(actorId, { kind, sourceDocumentId: id, expectedRevision });
}
export async function applyAssetSource(actorId: string, id: string, requestId: string) {
  await aparTransaction(async tx => { const request = await loadApproval(tx, requestId);
    if (!isAssetKind(request.requestKind) || request.sourceDocumentId !== id) throw new HttpError(409, "Approval does not belong to this asset source."); });
  return applyApprovedAction(actorId, requestId);
}
export function assetReconciliation(actorId: string) {
  return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, "ACCOUNTING_REPORT"); const totals = await loadAssetControlTotals(tx);
    const sub = new Map(totals.register.map(r => [`${r.role}:${r.accountId}`, { ...r, cents: accountingTotalCents(r.amount.toFixed(2)) }]));
    const gl = new Map(totals.ledger.map(r => [`${r.role}:${r.accountId}`, { ...r, cents: accountingTotalCents(r.amount.toFixed(2)) }]));
    const keys = [...new Set([...sub.keys(), ...gl.keys()])]; if (keys.length > 1000) throw new HttpError(413, "Asset control mapping exceeds the supported 1,000-account range.");
    const rows = keys.sort().map(key => { const left = sub.get(key), right = gl.get(key), variance = (left?.cents ?? 0n) - (right?.cents ?? 0n);
      return { role: left?.role ?? right?.role, accountId: left?.accountId ?? right?.accountId, register: centsToDecimal(left?.cents ?? 0n), generalLedger: centsToDecimal(right?.cents ?? 0n), variance: centsToDecimal(variance), reconciled: variance === 0n }; });
    return { reconciled: rows.every(r => r.reconciled), rows, basis: "All mapped GL control/expense lines versus approved actual asset/source/run evidence; pending or unregistered GL entries remain visible as variance." };
  });
}
export function listAssetSources(actorId: string, type: "ASSET" | "CATEGORY" | "RUN", page: number, pageSize: number, filters: { search?: string; categoryId?: string; status?: string } = {}) {
  return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, "ACCOUNTING_REPORT"); const skip = (page - 1) * pageSize;
    if (type === "ASSET") { const where = { assetCategoryId: filters.categoryId, status: filters.status, ...(filters.search ? { OR: [{ assetNumber: { contains: filters.search } }, { assetName: { contains: filters.search } }] } : {}) };
      const [total, rows] = await Promise.all([tx.accountingFixedAsset.count({ where }), tx.accountingFixedAsset.findMany({ where, take: pageSize, skip, orderBy: { assetNumber: "asc" } })]); return { page, pageSize, total, rows }; }
    if (type === "CATEGORY") { const where = filters.search ? { OR: [{ categoryCode: { contains: filters.search } }, { categoryName: { contains: filters.search } }] } : {};
      const [total, rows] = await Promise.all([tx.accountingAssetCategory.count({ where }), tx.accountingAssetCategory.findMany({ where, take: pageSize, skip, orderBy: { categoryCode: "asc" } })]); return { page, pageSize, total, rows }; }
    const where = { status: filters.status, runReference: filters.search ? { contains: filters.search } : undefined };
    const [total, rows] = await Promise.all([tx.accountingDepreciationRun.count({ where }), tx.accountingDepreciationRun.findMany({ where, take: pageSize, skip, orderBy: [{ runDate: "desc" }, { id: "desc" }] })]); return { page, pageSize, total, rows };
  });
}
export function getRun(actorId: string, id: string) { return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, "ACCOUNTING_REPORT"); return loadRun(tx, id); }); }
export function getChange(actorId: string, id: string) { return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, "ACCOUNTING_REPORT"); return loadAssetChange(tx, id); }); }
export function getCategory(actorId: string, id: string) { return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, "ACCOUNTING_REPORT"); const row = await tx.accountingAssetCategory.findUnique({ where: { id } }); if (!row) throw new HttpError(404, "Category not found."); return row; }); }
export function assetJournals(actorId: string, id: string) { return aparTransaction(async tx => { await requireAccountingPermission(tx, actorId, "ACCOUNTING_REPORT"); const asset = await loadAsset(tx, id);
  const ids = [asset.relFkAccFixedAssetSource.journalId, ...asset.changes.flatMap(d => d.postedJournalId ? [d.postedJournalId] : []),
    ...asset.revFkAccDepRunAssetAsset.flatMap(r => r.relFkAccDepRunAssetRun.postingJournalId ? [r.relFkAccDepRunAssetRun.postingJournalId] : [])];
  return { assetId: id, limit: 500, rows: await tx.accountingJournal.findMany({ where: { OR: [{ id: { in: ids } }, { reversalOfJournalId: { in: ids } }] }, include: { lines: true }, take: 500, orderBy: [{ accountingDate: "asc" }, { id: "asc" }] }) };
}); }
export function cancelAssetSource(actorId: string, type: "ASSET" | "RUN" | "CHANGE", id: string, revision: number, reason: string) {
  return aparTransaction(async tx => {
    await requireAccountingPermission(tx, actorId, ACCOUNTING_MANAGE);
    const source = type === "ASSET" ? await loadAsset(tx, id, true) : type === "RUN" ? await loadRun(tx, id) : (await loadAssetChange(tx, id)).draft;
    if (source.createdById !== actorId || source.status !== "DRAFT" || source.revision !== revision) throw new HttpError(409, "Only the owner can cancel the current unposted source.");
    const kind = type === "ASSET" ? "ASSET_ACTIVATE" : type === "RUN" ? "DEPRECIATION_RUN" : (await loadAssetChange(tx, id)).draft.sourceKind;
    const identity = await assetIdentity(tx, { requestKind: kind, sourceDocumentId: id });
    let requests = await tx.accountingApprovalRequest.findMany({ where: { sourceDocumentId: id, status: { in: ["PENDING", "APPROVED"] } } });
    if (!requests.length) { const last = await tx.accountingApprovalRequest.aggregate({ where: { sourceDocumentId: id, requestKind: kind }, _max: { sourceVersion: true } });
      requests = [await tx.accountingApprovalRequest.create({ data: { requestKind: kind, sourceDocumentId: id, ...identity.sourceLink,
        sourceVersion: Math.max(revision, (last._max.sourceVersion ?? 0) + 1), sourceDigest: identity.sourceDigest, requestedById: actorId,
        requestPayload: { snapshot: identity.material }, history: { create: { actorId, action: "SUBMIT", statusAfter: "PENDING", sourceDigest: identity.sourceDigest, remark: "Withdrawal audit only; no approval granted." } } } })]; }
    for (const request of requests) { await tx.accountingApprovalRequest.update({ where: { id: request.id }, data: { status: "CANCELLED" } });
      await appendApprovalHistory(tx, { approvalRequestId: request.id, actorId, action: "CANCEL", statusBefore: request.status, statusAfter: "CANCELLED", sourceDigest: request.sourceDigest, remark: reason }); }
    if (type === "ASSET") await tx.accountingFixedAsset.update({ where: { id }, data: { status: "CANCELLED", updatedById: actorId } });
    else if (type === "RUN") { await tx.accountingDepreciationRun.update({ where: { id }, data: { status: "VOID" } }); await tx.accountingDepreciationRunAsset.updateMany({ where: { depreciationRunId: id }, data: { activePeriodId: null } }); }
    else await tx.accountingJournalDraft.update({ where: { id }, data: { status: "CANCELLED", assetSourceLineId: null, assetCostLineId: null } });
    return { id, status: "CANCELLED", financialJournalCreated: false };
  });
}
