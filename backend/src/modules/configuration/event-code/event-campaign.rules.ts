import { HttpError } from "../../../lib/http.js";

export function assertCampaignParentActive(parentActive: boolean, activating: boolean) {
  if (activating && !parentActive) throw new HttpError(409, "Activate the parent Event Code before activating this Campaign.");
}

export function assertCampaignPeriodContainsTransactions(
  proposed: { startDate: string | null; endDate: string | null },
  linked: { earliest: Date | null; latest: Date | null; missingDates: number }
) {
  const first = linked.earliest?.toISOString().slice(0, 10);
  const last = linked.latest?.toISOString().slice(0, 10);
  if (((proposed.startDate || proposed.endDate) && linked.missingDates > 0)
    || (proposed.startDate && first && first < proposed.startDate)
    || (proposed.endDate && last && last > proposed.endDate))
    throw new HttpError(409, "Campaign period cannot exclude an already linked transaction. Widen the period to include its transaction date.");
}
