import { listCampaignFinancialSummaries } from "../../campaign/campaign-financial-summary.repository.js";
import type { CampaignMonitoringQuery } from "./campaign-monitoring.schema.js";

export async function getCampaignMonitoringWorkspace(query: CampaignMonitoringQuery) {
  const campaigns = await listCampaignFinancialSummaries(query);
  const summary = campaigns.reduce((total, campaign) => ({
    activeCampaigns: total.activeCampaigns + (campaign.displayStatus === "ACTIVE" ? 1 : 0),
    scheduledCampaigns: total.scheduledCampaigns + (campaign.displayStatus === "SCHEDULED" ? 1 : 0),
    targetAppliedCents: total.targetAppliedCents + BigInt(campaign.targetApplied.replace(".", "")),
    remainingCents: total.remainingCents + BigInt((campaign.remainingAmount ?? "0.00").replace(".", "")),
    carryCents: total.carryCents + BigInt(campaign.campaignCarry.replace(".", ""))
  }), { activeCampaigns: 0, scheduledCampaigns: 0, targetAppliedCents: 0n, remainingCents: 0n, carryCents: 0n });
  const money = (value: bigint) => {
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
  };
  return { summary: { activeCampaigns: summary.activeCampaigns, scheduledCampaigns: summary.scheduledCampaigns,
    totalTargetApplied: money(summary.targetAppliedCents), totalRemaining: money(summary.remainingCents), outstandingCampaignCarry: money(summary.carryCents) }, campaigns, generatedAt: new Date() };
}
