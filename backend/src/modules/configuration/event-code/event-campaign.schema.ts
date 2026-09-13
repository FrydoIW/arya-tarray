import { z } from "zod";
import { isValidPeriodDate } from "../../../lib/period.js";

const date = z.string().refine(isValidPeriodDate, "Date must use YYYY-MM-DD format").nullable();
export const campaignValueSchema = z.object({
  eventCodeId: z.string().uuid(),
  campaignName: z.string().trim().min(1).max(200),
  startDate: date,
  endDate: date,
  targetAmount: z.string().regex(/^\d{1,18}(?:\.\d{1,2})?$/, "Invalid target amount")
    .refine((value) => Number(value) > 0, "Target must be greater than zero").nullable(),
  activeFlag: z.boolean(),
  remark: z.string().trim().max(1000).nullable()
}).refine((value) => !value.startDate || !value.endDate || value.startDate <= value.endDate, {
  path: ["endDate"], message: "End date must not precede start date"
});

export const campaignExecuteSchema = z.object({
  creates: z.array(campaignValueSchema).default([]),
  updates: z.array(z.object({ id: z.string().uuid(), input: campaignValueSchema })).default([])
}).refine((value) => value.creates.length + value.updates.length > 0, "No Campaign changes to Execute");

export type CampaignExecuteInput = z.infer<typeof campaignExecuteSchema>;
