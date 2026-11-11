import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { HttpError } from "../../../lib/http.js";
import { assetInclude, assetMaterial, journalEffective, loadAsset, loadRun } from "./asset.repository.js";
import { assetChangeSchema, nonnegativeAmount } from "./asset.schema.js";
import { day } from "./asset.domain.js";
async function context(tx: Prisma.TransactionClient, id: string) {
  const [runRow, draft, sourceAssets, claims, original] = await Promise.all([
    tx.accountingDepreciationRun.findUnique({ where: { postingJournalId: id }, select: { id: true } }),
    tx.accountingJournalDraft.findUnique({ where: { postedJournalId: id } }),
    tx.accountingFixedAsset.findMany({ where: { relFkAccFixedAssetSource: { is: { journalId: id } } }, select: { id: true, status: true }, orderBy: { id: "asc" } }),
    tx.accountingJournalDraft.findMany({ where: { OR: [{ assetSourceLine: { is: { journalId: id } } }, { assetCostLine: { is: { journalId: id } } }],
      status: { in: ["DRAFT", "APPLIED", "POSTED"] }, AND: [{ OR: [{ postedJournalId: null }, { postedJournal: { is: { revFkAccJournalReversal: { is: null } } } }] }] }, select: { id: true }, orderBy: { id: "asc" } }),
    tx.accountingJournal.findUnique({ where: { id } })]);
  const run = runRow ? await loadRun(tx, runRow.id) : null;
  const asset = draft?.fixedAssetId ? await loadAsset(tx, draft.fixedAssetId) : null;
  return { run, draft, asset, sourceAssets, claims, original };
}
export async function assetReversalDigest(tx: Prisma.TransactionClient, id: string) {
  const c = await context(tx, id);
  return { sourceAssets: c.sourceAssets, claims: c.claims, run: c.run ? { id: c.run.id, status: c.run.status,
    assets: c.run.revFkAccDepRunAssetRun.map(row => assetMaterial(row.relFkAccDepRunAssetAsset)) } : null,
    asset: c.asset ? assetMaterial(c.asset) : null };
}
export async function validateAssetReversal(tx: Prisma.TransactionClient, id: string, date: Date) {
  const c = await context(tx, id);
  if (c.sourceAssets.some(a => a.status !== "CANCELLED") || c.claims.length) throw new HttpError(409, "Resolve asset registration/claimed evidence before reversing this source journal.");
  const assets = c.run ? c.run.revFkAccDepRunAssetRun.map(r => r.relFkAccDepRunAssetAsset) : c.asset ? [c.asset] : [];
  for (const asset of assets) {
    const laterRun = asset.revFkAccDepRunAssetAsset.some(row => { const j = row.relFkAccDepRunAssetRun.relFkAccDepRunJournal;
      return j && j.id !== id && c.original && j.accountingDate > c.original.accountingDate && journalEffective(j, new Date("9999-12-31")); });
    const laterChange = asset.changes.some(d => d.postedJournalId !== id && ["POSTED", "APPLIED"].includes(d.status)
      && c.original && d.accountingDate >= c.original.accountingDate && (d.status === "APPLIED" || !d.postedJournal?.revFkAccJournalReversal));
    if (laterRun || laterChange || asset.disposalJournalId && asset.disposalJournalId !== id) throw new HttpError(409, "Reverse/review later asset activity before reversing this entry.");
    if (date < (c.original?.accountingDate ?? asset.inServiceOn)) throw new HttpError(409, "Asset reversal cannot predate its source.");
  }
  return c;
}
const priorSnapshot = z.object({ snapshot: z.object({ asset: z.object({ category: z.string().uuid(), start: z.string(), life: z.string().regex(/^\d+$/), residual: nonnegativeAmount }) }).passthrough() }).passthrough();
export async function applyAssetReversal(tx: Prisma.TransactionClient, id: string, actorId: string) {
  const c = await context(tx, id);
  if (c.run) {
    await tx.accountingDepreciationRun.update({ where: { id: c.run.id }, data: { status: "VOID" } });
    await tx.accountingDepreciationRunAsset.updateMany({ where: { depreciationRunId: c.run.id }, data: { activePeriodId: null } });
  }
  if (c.asset && c.draft?.sourceKind === "ASSET_JOURNAL") {
    const applied = await tx.accountingApprovalRequest.findUnique({ where: { appliedJournalId: id } });
    const prior = priorSnapshot.parse(applied?.requestPayload).snapshot.asset;
    const command = assetChangeSchema.parse(c.draft.assetMetadata);
    const data: Prisma.AccountingFixedAssetUncheckedUpdateInput = { revision: { increment: 1 }, updatedById: actorId };
    if (command.action === "RECLASSIFY") data.assetCategoryId = prior.category;
    if (command.action === "IMPAIRMENT") { data.depreciationStartOn = day(prior.start); data.usefulLifeMonths = Number(prior.life); data.residualValue = prior.residual; }
    if (command.action === "DISPOSE" || command.action === "WRITE_OFF") { data.status = "ACTIVE"; data.disposedOn = null; data.disposalJournalId = null; }
    await tx.accountingFixedAsset.update({ where: { id: c.asset.id }, data });
    await tx.accountingJournalDraft.update({ where: { id: c.draft.id }, data: { assetSourceLineId: null, assetCostLineId: null } });
  }
}
