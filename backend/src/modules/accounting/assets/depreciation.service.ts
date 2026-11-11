import type { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { accountingCents } from "../accounting.domain.js";
import { centsToDecimal } from "../../../lib/money.js";
import { assetMaterial, assetState, policyOf, type AssetRecord } from "./asset.repository.js";
import { dateText, straightLinePortion } from "./asset.domain.js";
export function depreciationQuote(asset: AssetRecord, period: { startDate: Date; endDate: Date }) {
  const state = assetState(asset), policy = policyOf(asset);
  if (asset.status !== "ACTIVE" || state.disposed || asset.relFkAccFixedAssetSource.journal.revFkAccJournalReversal) throw new HttpError(409, "Only an authorized active unreversed asset can be depreciated.");
  if (asset.depreciationMethod !== "STRAIGHT_LINE") throw new HttpError(409, "Only the reviewed straight-line method is supported.");
  const epoch = asset.depreciationStartOn, beforeDate = new Date(epoch.getTime() - 86400000);
  const beforeEpoch = assetState(asset, beforeDate), atEpoch = assetState(asset, epoch);
  const originalLate = asset.relFkAccFixedAssetSource.journal.accountingDate > epoch ? accountingCents(asset.relFkAccFixedAssetSource.debit) : 0n;
  const basis = atEpoch.gross + originalLate - beforeEpoch.accumulated - atEpoch.impairment - accountingCents(asset.residualValue);
  if (basis < 0n) throw new HttpError(409, "Residual value exceeds the prospective depreciable amount.");
  const portion = straightLinePortion(basis, epoch, asset.usefulLifeMonths, policy.partialMonthPolicy, period.startDate, period.endDate);
  const sinceEpoch = state.accumulated - beforeEpoch.accumulated;
  if (portion.amount > 0n && (period.endDate < state.latest || period.endDate < asset.inServiceOn
    || sinceEpoch !== portion.expectedBefore)) throw new HttpError(409, "Resolve earlier depreciation or later asset activity first; no implicit catch-up/backdated posting.");
  const remaining = state.carrying - accountingCents(asset.residualValue);
  if (portion.amount > remaining) throw new HttpError(409, "Depreciation would exceed the remaining depreciable amount.");
  return { amount: centsToDecimal(portion.amount), snapshot: { asset: assetMaterial(asset), periodStart: dateText(period.startDate), periodEnd: dateText(period.endDate),
    prospectiveBasis: String(basis), expectedBefore: String(portion.expectedBefore), amount: centsToDecimal(portion.amount) } };
}
export async function configuredRunPeriod(tx: Prisma.TransactionClient, id: string) {
  const period = await tx.accountingPeriod.findUnique({ where: { id }, include: { relFkAccPeriodFy: true } });
  if (!period || period.status !== "OPEN" || period.relFkAccPeriodFy.status !== "OPEN") throw new HttpError(409, "An OPEN accounting period and fiscal year are required.");
  if (period.startDate.getUTCDate() !== 1 || new Date(period.endDate.getTime() + 86400000).getUTCDate() !== 1
    || period.startDate.getUTCMonth() !== period.endDate.getUTCMonth()) throw new HttpError(409, "Depreciation runs require existing complete calendar-month accounting periods.");
  return period;
}
