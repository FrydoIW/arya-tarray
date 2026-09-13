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

export type TimeRuleExecuteInput = z.infer<typeof timeRuleExecuteSchema>;
