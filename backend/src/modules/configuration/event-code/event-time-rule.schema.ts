import { z } from "zod";

const amount = z.string().regex(/^\d{1,18}(?:\.\d{1,2})?$/, "Unit amount is invalid")
  .refine(value => Number(value) > 0, "Unit amount must be greater than zero");

export const timeRuleValueSchema = z.object({
  unitAmount: amount,
  durationMonths: z.coerce.number().int().min(1).max(1200),
  activeFlag: z.boolean(),
  remark: z.string().trim().max(1000).nullable()
});

export const timeRuleExecuteSchema = z.object({
  eventCodeId: z.string().uuid(),
  input: timeRuleValueSchema
});

export const timeRuleBulkExecuteSchema = z.object({
  updates: z.array(timeRuleExecuteSchema).min(1, "No Time Rule changes to Execute")
}).refine(value => new Set(value.updates.map(item => item.eventCodeId)).size === value.updates.length, {
  message: "Each Event Code can only have one staged Time Rule"
});

export type TimeRuleExecuteInput = z.infer<typeof timeRuleExecuteSchema>;
export type TimeRuleBulkExecuteInput = z.infer<typeof timeRuleBulkExecuteSchema>;
