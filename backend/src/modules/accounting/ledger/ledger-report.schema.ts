import { z } from "zod";
import { dateOnly } from "../period/period.schema.js";

export const ledgerReportQuerySchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly,
  accountId: z.string().uuid().optional(),
  accountingFundId: z.string().uuid().optional(),
  eventCampaignId: z.string().uuid().optional(),
  accountingPeriodId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
}).refine(value => !value.from || value.from <= value.to, { path: ["to"], message: "End date precedes start date" });

export type LedgerReportQuery = z.infer<typeof ledgerReportQuerySchema>;
