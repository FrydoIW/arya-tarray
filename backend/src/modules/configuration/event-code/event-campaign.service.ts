import type { CampaignExecuteInput } from "./event-campaign.schema.js";
import { currentBusinessDayValue } from "../../../lib/business-time.js";
import { listCampaignFinancialSummaries } from "../../campaign/campaign-financial-summary.repository.js";
import { campaignDisplayStatus } from "../../campaign/campaign-financial-summary.domain.js";
import { applyCampaignChangesAtomic } from "./event-campaign.repository.js";

export { campaignDisplayStatus } from "../../campaign/campaign-financial-summary.domain.js";

export async function getCampaignSummaries(options: { dashboard?: boolean } = {}) {
  return listCampaignFinancialSummaries(options.dashboard
    ? { activeRelevantFrom: new Date(`${currentBusinessDayValue()}T00:00:00.000Z`), take: 6 }
    : {});
}

export async function executeCampaignChanges(input: CampaignExecuteInput, userId: string) {
  await applyCampaignChangesAtomic({ ...input, userId });
  return { changedCount: input.creates.length + input.updates.length, items: await getCampaignSummaries() };
}
