import { Prisma } from "@prisma/client";
import { currentBusinessDayValue } from "../../../lib/business-time.js";
import type { CampaignExecuteInput } from "./event-campaign.schema.js";
import { applyCampaignChangesAtomic, listCampaignRecords } from "./event-campaign.repository.js";

function dateValue(value: Date | null) { return value ? value.toISOString().slice(0, 10) : null; }

export function campaignDisplayStatus(campaign: { activeFlag: boolean; startDate: Date | null; endDate: Date | null }, today = currentBusinessDayValue()) {
  if (!campaign.activeFlag) return "CLOSED" as const;
  if (campaign.startDate && today < dateValue(campaign.startDate)!) return "SCHEDULED" as const;
  if (campaign.endDate && today > dateValue(campaign.endDate)!) return "ENDED" as const;
  return "ACTIVE" as const;
}

export async function getCampaignSummaries(options: { dashboard?: boolean } = {}) {
  const { campaigns, totals } = await listCampaignRecords(options.dashboard
    ? { activeRelevantFrom: new Date(`${currentBusinessDayValue()}T00:00:00.000Z`), take: 6 }
    : {});
  const totalById = new Map(totals.map((row) => [row.eventCampaignId, row._sum.originalAmount ?? new Prisma.Decimal(0)]));
  return campaigns.map((campaign) => {
    const collected = totalById.get(campaign.id) ?? new Prisma.Decimal(0);
    const target = campaign.targetAmount;
    return {
      id: campaign.id,
      eventCodeId: campaign.eventCodeId,
      campaignName: campaign.campaignName,
      eventCode: campaign.eventCode,
      startDate: dateValue(campaign.startDate),
      endDate: dateValue(campaign.endDate),
      targetAmount: target?.toString() ?? null,
      collectedAmount: collected.toString(),
      remainingAmount: target ? target.minus(collected).toString() : null,
      progressPercent: target ? collected.div(target).mul(100).toNumber() : null,
      targetReached: target ? collected.greaterThanOrEqualTo(target) : false,
      displayStatus: campaignDisplayStatus(campaign),
      activeFlag: campaign.activeFlag,
      remark: campaign.remark,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      updatedBy: campaign.updatedBy
    };
  });
}

export async function executeCampaignChanges(input: CampaignExecuteInput, userId: string) {
  await applyCampaignChangesAtomic({ ...input, userId });
  return { changedCount: input.creates.length + input.updates.length, items: await getCampaignSummaries() };
}
