import { z } from "zod";
import { currentBusinessMonthValue } from "../../lib/business-time.js";
import { isValidPeriodDate } from "../../lib/period.js";

const date = z.string().refine(isValidPeriodDate, "Invalid business date");
export const accountingQuerySchema = z.object({
  view: z.enum(["journals", "ledger", "trial", "monthly", "reconciliation", "pending"]).default("journals"),
  from: date.default(() => `${currentBusinessMonthValue()}-01`),
  to: date.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  accountCode: z.enum(["1110", "4110"]).optional(),
  bankAccountId: z.string().uuid().optional(), eventCodeId: z.string().uuid().optional(),
  eventCampaignId: z.string().uuid().optional(), memberId: z.string().uuid().optional(),
  eventType: z.enum(["STANDARD", "CAMPAIGN", "TIME_BASED"]).optional(),
  journalNumber: z.string().trim().max(60).optional(),
  journalType: z.enum(["RECOGNITION", "RECLASSIFICATION"]).optional(),
  format: z.enum(["xlsx", "pdf"]).default("xlsx")
}).superRefine((q, ctx) => {
  if (q.to && q.to < q.from) ctx.addIssue({ code: "custom", path: ["to"], message: "End date precedes start date" });
});
export type AccountingQuery = z.infer<typeof accountingQuerySchema>;
