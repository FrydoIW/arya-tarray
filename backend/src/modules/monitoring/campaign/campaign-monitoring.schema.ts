import { z } from "zod";

export const campaignMonitoringQuerySchema = z.object({
  status: z.enum(["ACTIVE", "SCHEDULED", "ENDED", "CLOSED"]).optional(),
  search: z.string().trim().max(100).optional()
});
export type CampaignMonitoringQuery = z.infer<typeof campaignMonitoringQuerySchema>;
