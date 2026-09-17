import { HttpError } from "../../lib/http.js";

export type CampaignEvent = { id: string; eventType: string; activeFlag: boolean };
export type CampaignOption = {
  id: string;
  eventCodeId: string;
  activeFlag: boolean;
  startDate: Date | null;
  endDate: Date | null;
};

export type CampaignEligibilityInput = {
  eventCode: CampaignEvent | null;
  campaign: CampaignOption | null;
  transactionDate: Date | null;
};

export type CampaignEligibilityReason =
  | "ELIGIBLE"
  | "EVENT_NOT_CAMPAIGN"
  | "EVENT_INACTIVE"
  | "CAMPAIGN_MISSING"
  | "CAMPAIGN_OWNERSHIP"
  | "CAMPAIGN_INACTIVE"
  | "DATE_MISSING"
  | "DATE_OUT_OF_PERIOD";

function day(value: Date) { return value.toISOString().slice(0, 10); }

export function campaignEligibilityReason(input: CampaignEligibilityInput): CampaignEligibilityReason {
  if (!input.eventCode || input.eventCode.eventType !== "CAMPAIGN") return "EVENT_NOT_CAMPAIGN";
  if (!input.eventCode.activeFlag) return "EVENT_INACTIVE";
  if (!input.campaign) return "CAMPAIGN_MISSING";
  if (input.campaign.eventCodeId !== input.eventCode.id) return "CAMPAIGN_OWNERSHIP";
  if (!input.campaign.activeFlag) return "CAMPAIGN_INACTIVE";
  if (!input.transactionDate) return "DATE_MISSING";
  const transactionDay = day(input.transactionDate);
  if ((input.campaign.startDate && transactionDay < day(input.campaign.startDate))
    || (input.campaign.endDate && transactionDay > day(input.campaign.endDate))) {
    return "DATE_OUT_OF_PERIOD";
  }
  return "ELIGIBLE";
}

export function isCampaignEligibleForClassification(input: CampaignEligibilityInput) {
  return campaignEligibilityReason(input) === "ELIGIBLE";
}

export function selectSingleEligibleCampaign(input: {
  eventCode: CampaignEvent | null;
  campaigns: CampaignOption[];
  transactionDate: Date | null;
}) {
  const eligible = input.campaigns.filter((campaign) =>
    isCampaignEligibleForClassification({ eventCode: input.eventCode, campaign, transactionDate: input.transactionDate })
  );
  return eligible.length === 1 ? eligible[0].id : null;
}

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
  const reason = campaignEligibilityReason({
    eventCode: input.eventCode,
    campaign: input.campaign,
    transactionDate: input.transactionDate
  });
  if (reason === "ELIGIBLE") return;
  if (reason === "EVENT_INACTIVE") throw new HttpError(400, "The selected Final Event is inactive or no longer available");
  if (reason === "CAMPAIGN_INACTIVE") throw new HttpError(400, "The selected Campaign is inactive");
  if (reason === "DATE_MISSING") throw new HttpError(400, "Transaction date is required to select a Campaign");
  if (reason === "DATE_OUT_OF_PERIOD") throw new HttpError(400, "Campaign is not valid on the transaction date");
  throw new HttpError(400, "Campaign does not belong to the selected Event Code");
}
