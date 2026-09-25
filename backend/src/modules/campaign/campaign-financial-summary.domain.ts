import { currentBusinessDayValue } from "../../lib/business-time.js";

function dateValue(value: Date | null) { return value ? value.toISOString().slice(0, 10) : null; }

export function campaignDisplayStatus(campaign: { activeFlag: boolean; startDate: Date | null; endDate: Date | null }, today = currentBusinessDayValue()) {
  if (!campaign.activeFlag) return "CLOSED" as const;
  if (campaign.startDate && today < dateValue(campaign.startDate)!) return "SCHEDULED" as const;
  if (campaign.endDate && today > dateValue(campaign.endDate)!) return "ENDED" as const;
  return "ACTIVE" as const;
}

export { dateValue as campaignDateValue };
