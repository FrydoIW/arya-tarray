import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { centsToDecimal, decimalStringToCents } from "../../lib/money.js";
import { campaignDateValue, campaignDisplayStatus } from "./campaign-financial-summary.domain.js";

const cents = (value: { toString(): string } | null | undefined) => decimalStringToCents(value?.toString() ?? "0");

export const campaignFinancialSelect = {
  id: true, eventCodeId: true, campaignName: true, startDate: true, endDate: true, targetAmount: true, activeFlag: true,
  remark: true, createdAt: true, updatedAt: true, updatedBy: { select: { id: true, fullName: true } },
  eventCode: { select: { id: true, code: true, eventName: true, eventType: true, activeFlag: true } }
} as const;

export type CampaignFinancialSummaryOptions = { activeRelevantFrom?: Date; take?: number; search?: string; status?: string };

export async function listCampaignFinancialSummaries(options: CampaignFinancialSummaryOptions = {}, client: Pick<typeof prisma,
  "eventCampaign" | "bankTransaction" | "memberEventCampaignAllocation" | "memberEventCampaignWalletLedger"> = prisma) {
  const campaigns = await client.eventCampaign.findMany({
    where: options.activeRelevantFrom ? { activeFlag: true, eventCode: { activeFlag: true }, OR: [{ endDate: null }, { endDate: { gte: options.activeRelevantFrom } }] }
      : options.search ? { OR: [{ campaignName: { contains: options.search } }, { eventCode: { is: { code: { contains: options.search } } } }, { eventCode: { is: { eventName: { contains: options.search } } } }] } : undefined,
    select: campaignFinancialSelect, orderBy: [{ activeFlag: "desc" }, { startDate: "desc" }, { createdAt: "desc" }], take: options.take
  });
  const ids = campaigns.map(row => row.id);
  const [direct, legacy, allocations, wallets] = ids.length ? await Promise.all([
    client.bankTransaction.groupBy({ by: ["eventCampaignId"], where: { eventCampaignId: { in: ids }, status: "FINALIZED", reconciliationExcludedAt: null, originalAmount: { gt: 0 } }, _sum: { originalAmount: true } }),
    client.bankTransaction.groupBy({ by: ["eventCampaignId"], where: { eventCampaignId: { in: ids }, status: "FINALIZED", reconciliationExcludedAt: null, originalAmount: { gt: 0 }, memberEventCampaignAllocations: { none: {} } }, _sum: { originalAmount: true } }),
    client.memberEventCampaignAllocation.groupBy({ by: ["eventCampaignId", "allocationType"], where: { eventCampaignId: { in: ids }, allocationStatus: "ACTIVE" }, _sum: { amountDelta: true } }),
    client.memberEventCampaignWalletLedger.groupBy({ by: ["eventCampaignId"], where: { eventCampaignId: { in: ids }, entryStatus: "ACTIVE" }, _sum: { amountDelta: true } })
  ]) : [[], [], [], []];
  const directById = new Map(direct.flatMap(row => row.eventCampaignId ? [[row.eventCampaignId, cents(row._sum.originalAmount)] as const] : []));
  const legacyById = new Map(legacy.flatMap(row => row.eventCampaignId ? [[row.eventCampaignId, cents(row._sum.originalAmount)] as const] : []));
  const walletById = new Map(wallets.flatMap(row => row.eventCampaignId ? [[row.eventCampaignId, cents(row._sum.amountDelta)] as const] : []));
  const allocationById = new Map<string, { targetApplied: bigint; carryAllocation: bigint }>();
  for (const row of allocations) {
    if (!row.eventCampaignId) continue;
    const current = allocationById.get(row.eventCampaignId) ?? { targetApplied: 0n, carryAllocation: 0n };
    const amount = cents(row._sum.amountDelta); current.targetApplied += amount;
    if (row.allocationType === "CARRY_TRANSFER" || row.allocationType === "CARRY_REVERSAL") current.carryAllocation += amount;
    allocationById.set(row.eventCampaignId, current);
  }
  return campaigns.map(campaign => {
    const allocation = allocationById.get(campaign.id) ?? { targetApplied: 0n, carryAllocation: 0n };
    const targetApplied = allocation.targetApplied + (legacyById.get(campaign.id) ?? 0n);
    const target = campaign.targetAmount ? cents(campaign.targetAmount) : null;
    const status = campaignDisplayStatus({ ...campaign, activeFlag: campaign.activeFlag && campaign.eventCode.activeFlag });
    return { id: campaign.id, campaignId: campaign.id, eventCodeId: campaign.eventCodeId, campaignName: campaign.campaignName, eventCode: campaign.eventCode,
      startDate: campaignDateValue(campaign.startDate), endDate: campaignDateValue(campaign.endDate), targetAmount: target === null ? null : centsToDecimal(target),
      directContribution: centsToDecimal(directById.get(campaign.id) ?? 0n), carryAllocation: centsToDecimal(allocation.carryAllocation),
      targetApplied: centsToDecimal(targetApplied), remainingAmount: target === null ? null : centsToDecimal(target > targetApplied ? target - targetApplied : 0n),
      campaignCarry: centsToDecimal(walletById.get(campaign.id) ?? 0n), progressPercent: target ? Number((targetApplied * 10000n) / target) / 100 : null,
      targetReached: target !== null && targetApplied >= target, displayStatus: status, activeFlag: campaign.activeFlag, remark: campaign.remark,
      createdAt: campaign.createdAt, updatedAt: campaign.updatedAt, updatedBy: campaign.updatedBy };
  }).filter(row => !options.status || row.displayStatus === options.status);
}
