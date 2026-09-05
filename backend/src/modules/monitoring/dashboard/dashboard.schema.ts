import { z } from "zod";
import { isValidPeriodDate } from "../../../lib/period.js";

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export const dashboardWorkspaceQuerySchema = z.object({
  periodMode: z.enum(["MONTH", "DAY"]).optional(),
  month: z.string().regex(monthPattern, "Month must use YYYY-MM format").optional(),
  date: z.string().refine(isValidPeriodDate, "Date must use YYYY-MM-DD format").optional()
}).superRefine((value, context) => {
  if (value.periodMode === "DAY" && !value.date) context.addIssue({ code: z.ZodIssueCode.custom, path: ["date"], message: "Date is required when periodMode is DAY" });
  if (value.periodMode === "MONTH" && !value.month) context.addIssue({ code: z.ZodIssueCode.custom, path: ["month"], message: "Month is required when periodMode is MONTH" });
  if (!value.periodMode && value.date) context.addIssue({ code: z.ZodIssueCode.custom, path: ["periodMode"], message: "periodMode is required when date is supplied" });
});

export type DashboardWorkspaceQuery = z.infer<typeof dashboardWorkspaceQuerySchema>;
