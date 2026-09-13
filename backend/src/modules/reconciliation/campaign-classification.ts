import { HttpError } from "../../lib/http.js";

export type CampaignEvent = { id: string; eventType: string };
export type CampaignOption = {
  id: string;
  eventCodeId: string;
  activeFlag: boolean;
  startDate: Date | null;
  endDate: Date | null;
};

function day(value: Date) { return value.toISOString().slice(0, 10); }

export function assertCampaignClassification(input: {
  eventCode: CampaignEvent | null;
  campaignId: string | null;
  campaign: CampaignOption | null;
  transactionDate: Date | null;
  requiresClassification: boolean;
  requireComplete: boolean;
  historicalCampaignId?: string | null;
}) {
  if (!input.requiresClassification || !input.eventCode) {
    if (input.campaignId) throw new HttpError(400, "Campaign is not applicable to this transaction");
    return;
  }
  if (input.eventCode.eventType !== "CAMPAIGN") {
    if (input.campaignId) throw new HttpError(400, "Only CAMPAIGN Event Codes may have a Campaign");
    return;
  }
  if (!input.campaignId) {
    if (input.requireComplete) throw new HttpError(400, "Campaign is required for a CAMPAIGN Final Event");
    return;
  }
  if (!input.campaign || input.campaign.eventCodeId !== input.eventCode.id) {
    throw new HttpError(400, "Campaign does not belong to the selected Event Code");
  }
  if (input.historicalCampaignId === input.campaignId) return;
  if (!input.campaign.activeFlag) throw new HttpError(400, "The selected Campaign is inactive");
  if (!input.transactionDate) throw new HttpError(400, "Transaction date is required to select a Campaign");
  const transactionDay = day(input.transactionDate);
  if ((input.campaign.startDate && transactionDay < day(input.campaign.startDate))
    || (input.campaign.endDate && transactionDay > day(input.campaign.endDate))) {
    throw new HttpError(400, "Campaign is not valid on the transaction date");
  }
}
