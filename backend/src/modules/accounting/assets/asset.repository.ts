import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { accountingCents } from "../accounting.domain.js";
import { assetChangeSchema, assetPolicySchema } from "./asset.schema.js";
import { dateText } from "./asset.domain.js";
export const assetJournalInclude = { revFkAccJournalReversal: true, lines: { include: { account: true }, orderBy: { lineNo: "asc" as const } } };
export const assetInclude = { relFkAccFixedAssetCat: true,
  relFkAccFixedAssetSource: { include: { account: true, journal: { include: assetJournalInclude } } },
  relFkAccFixedAssetDisposal: { include: assetJournalInclude },
  changes: { orderBy: { id: "asc" as const }, take: 601, include: { postedJournal: { include: assetJournalInclude },
    assetSourceLine: { include: { journal: { include: { revFkAccJournalReversal: true } } } }, assetCostLine: { include: { journal: { include: { revFkAccJournalReversal: true } } } } } },
  revFkAccDepRunAssetAsset: { take: 601, include: { relFkAccDepRunAssetRun: { include: { relFkAccDepRunJournal: { include: assetJournalInclude }, relFkAccDepRunPeriod: true } },
    relFkAccDepRunAssetExp: true, relFkAccDepRunAssetAccum: true } } };
export type AssetRecord = Prisma.AccountingFixedAssetGetPayload<{ include: typeof assetInclude }>;
export async function loadAsset(tx: Prisma.TransactionClient, id: string, lock = false) {
  if (lock) await tx.$queryRaw`SELECT fixed_asset_id FROM arya_accounting_fixed_asset WHERE fixed_asset_id=${id} FOR UPDATE`;
  const asset = await tx.accountingFixedAsset.findUnique({ where: { id }, include: assetInclude });
  if (!asset) throw new HttpError(404, "Fixed asset was not found.");
  if (asset.changes.length > 600 || asset.revFkAccDepRunAssetAsset.length > 600) throw new HttpError(413, "Asset history exceeds the supported bounded review range.");
  return asset;
}
export function journalEffective(j: { accountingDate: Date; revFkAccJournalReversal: { accountingDate: Date } | null } | null, asOf: Date) {
  return Boolean(j && j.accountingDate <= asOf && (!j.revFkAccJournalReversal || j.revFkAccJournalReversal.accountingDate > asOf));
}
export function assetState(asset: AssetRecord, asOf = new Date("9999-12-31")) {
  let gross = journalEffective(asset.relFkAccFixedAssetSource.journal, asOf) ? accountingCents(asset.relFkAccFixedAssetSource.debit) : 0n;
  let accumulated = 0n, impairment = 0n;
  const dates = [asset.relFkAccFixedAssetSource.journal.accountingDate];
  for (const draft of asset.changes) {
    const metadata = assetChangeSchema.safeParse(draft.assetMetadata);
    if (!metadata.success) throw new HttpError(409, "Asset change evidence is invalid.");
    if (["APPLIED", "POSTED"].includes(draft.status)) dates.push(new Date(metadata.data.effectiveDate));
    if (draft.assetSourceLine && metadata.data.action === "ADDITIONAL" && draft.status === "APPLIED" && journalEffective(draft.assetSourceLine.journal, asOf)) gross += accountingCents(draft.assetSourceLine.debit);
    if (metadata.data.action === "IMPAIRMENT" && journalEffective(draft.postedJournal, asOf)) {
      impairment += draft.postedJournal?.lines.filter(l => l.account.accountType === "ASSET" && l.account.contraFlag)
        .reduce((n, l) => n + accountingCents(l.credit) - accountingCents(l.debit), 0n) ?? 0n;
    }
    if (draft.postedJournal) dates.push(draft.postedJournal.accountingDate);
    if (draft.postedJournal?.revFkAccJournalReversal) dates.push(draft.postedJournal.revFkAccJournalReversal.accountingDate);
  }
  for (const row of asset.revFkAccDepRunAssetAsset) {
    const journal = row.relFkAccDepRunAssetRun.relFkAccDepRunJournal;
    if (journalEffective(journal, asOf)) accumulated += accountingCents(row.relFkAccDepRunAssetAccum?.credit ?? "0") - accountingCents(row.relFkAccDepRunAssetAccum?.debit ?? "0");
    if (journal) dates.push(journal.accountingDate);
    if (journal?.revFkAccJournalReversal) dates.push(journal.revFkAccJournalReversal.accountingDate);
  }
  const disposed = journalEffective(asset.relFkAccFixedAssetDisposal, asOf);
  if (asset.relFkAccFixedAssetDisposal) dates.push(asset.relFkAccFixedAssetDisposal.accountingDate);
  if (asset.relFkAccFixedAssetDisposal?.revFkAccJournalReversal) dates.push(asset.relFkAccFixedAssetDisposal.revFkAccJournalReversal.accountingDate);
  const carrying = gross - accumulated - impairment;
  if (carrying < 0n) throw new HttpError(409, "Asset evidence produces a negative carrying amount.");
  return { gross, accumulated, impairment, carrying, disposed, latest: new Date(Math.max(...dates.map(d => d.getTime()))),
    costControl: disposed ? 0n : gross, accumulatedControl: disposed ? 0n : accumulated, impairmentControl: disposed ? 0n : impairment };
}
export function policyOf(asset: AssetRecord) {
  const parsed = assetPolicySchema.passthrough().safeParse(asset.policySnapshot);
  if (!parsed.success) throw new HttpError(409, "PENDING POLICY: an explicitly reviewed capitalization and depreciation policy is required."); return parsed.data;
}
export async function requireCategory(tx: Prisma.TransactionClient, id: string, active = true) {
  const category = await tx.accountingAssetCategory.findUnique({ where: { id } });
  if (!category || active && !category.activeFlag) throw new HttpError(409, "An active asset category is required.");
  const mapping: Array<[string | null, string, string, boolean]> = [[category.assetAccountId, "ASSET", "DEBIT", false],
    [category.accumulatedDepreciationAccountId, "ASSET", "CREDIT", true], [category.depreciationExpenseAccountId, "EXPENSE", "DEBIT", false],
    [category.gainAccountId, "REVENUE", "CREDIT", false], [category.lossAccountId, "EXPENSE", "DEBIT", false],
    [category.impairmentExpenseAccountId, "EXPENSE", "DEBIT", false], [category.impairmentAllowanceAccountId, "ASSET", "CREDIT", true], [category.disposalClearingAccountId, "LIABILITY", "CREDIT", false]];
  const rows = await tx.accountingAccount.findMany({ where: { id: { in: mapping.flatMap(([id]) => id ? [id] : []) } } });
  if (mapping.some(([id, type, balance, contra]) => id && !rows.some(r => r.id === id && r.activeFlag && r.postingFlag && r.accountType === type && r.normalBalance === balance && r.contraFlag === contra))
    || category.assetAccountId === category.accumulatedDepreciationAccountId || category.impairmentAllowanceAccountId === category.accumulatedDepreciationAccountId) throw new HttpError(409, "Category mapping requires active posting accounts with correct type, normal balance and contra classification.");
  return category;
}
export async function claimSource(tx: Prisma.TransactionClient, id: string, assetId?: string, draftId?: string) {
  await tx.$queryRaw`SELECT accounting_journal_line_id FROM arya_accounting_journal_line WHERE accounting_journal_line_id=${id} FOR UPDATE`;
  const line = await tx.accountingJournalLine.findUnique({ where: { id }, include: { account: true, journal: { include: assetJournalInclude } } });
  if (!line || line.journal.revFkAccJournalReversal) throw new HttpError(409, "An actual unreversed posted source line is required.");
  const [asset, claims, schedule] = await Promise.all([
    tx.accountingFixedAsset.findFirst({ where: { acquisitionJournalLineId: id, ...(assetId ? { id: { not: assetId } } : {}) }, select: { id: true } }),
    tx.accountingJournalDraft.findFirst({ where: { OR: [{ assetSourceLineId: id }, { assetCostLineId: id }], status: { in: ["DRAFT", "APPLIED", "POSTED"] }, ...(draftId ? { id: { not: draftId } } : {}) }, select: { id: true } }),
    tx.accountingSchedule.findFirst({ where: { sourceJournalLineId: id, OR: [{ status: { not: "CANCELLED" } }, { revFkAccSchedulePeriodParent: { some: { relFkAccSchedulePeriodJournal: { is: { revFkAccJournalReversal: { is: null } } } } } }] }, select: { id: true } })]);
  if (asset || claims || schedule) throw new HttpError(409, "Source line is already claimed by another asset, change or schedule."); return line;
}
export const runInclude = { relFkAccDepRunPeriod: true, relFkAccDepRunJournal: { include: assetJournalInclude },
  revFkAccDepRunAssetRun: { orderBy: { fixedAssetId: "asc" as const }, include: { relFkAccDepRunAssetAsset: { include: assetInclude } } } };
export async function loadRun(tx: Prisma.TransactionClient, id: string) {
  const run = await tx.accountingDepreciationRun.findUnique({ where: { id }, include: runInclude });
  if (!run) throw new HttpError(404, "Depreciation run was not found."); return run;
}
export function assetMaterial(asset: AssetRecord) {
  const s = assetState(asset);
  return { id: asset.id, revision: String(asset.revision), status: asset.status, code: asset.assetNumber, name: asset.assetName,
    description: asset.description, location: asset.location, custodian: asset.custodianId, category: asset.assetCategoryId,
    source: asset.acquisitionJournalLineId, sourceDocument: asset.sourceDocumentId, vendor: asset.vendorId,
    acquired: dateText(asset.acquiredOn), available: dateText(asset.inServiceOn), start: dateText(asset.depreciationStartOn),
    life: String(asset.usefulLifeMonths), residual: asset.residualValue.toFixed(2), policy: asset.policySnapshot,
    cost: String(s.gross), accumulated: String(s.accumulated), impairment: String(s.impairment), latest: dateText(s.latest),
    mappings: { asset: asset.relFkAccFixedAssetCat.assetAccountId, accumulated: asset.relFkAccFixedAssetCat.accumulatedDepreciationAccountId,
      expense: asset.relFkAccFixedAssetCat.depreciationExpenseAccountId, gain: asset.relFkAccFixedAssetCat.gainAccountId, loss: asset.relFkAccFixedAssetCat.lossAccountId,
      impairment: asset.relFkAccFixedAssetCat.impairmentAllowanceAccountId, impairmentExpense: asset.relFkAccFixedAssetCat.impairmentExpenseAccountId,
      clearing: asset.relFkAccFixedAssetCat.disposalClearingAccountId, categoryRevision: String(asset.relFkAccFixedAssetCat.revision), categoryPolicy: asset.relFkAccFixedAssetCat.policy } };
}
