import { z } from "zod";
import { isValidPeriodDate } from "../../../lib/period.js";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must use YYYY-MM format");
const dateSchema = z.string().refine(isValidPeriodDate, "Date must use YYYY-MM-DD format");
const statusSchema = z.enum(["ALL", "RAW", "CHECK", "FINALIZED"]);
const optionalUuidSchema = z.string().uuid().optional();
const periodModeSchema = z.enum(["MONTH", "DAY"]);

function validatePeriod(value: { periodMode?: "MONTH" | "DAY"; month?: string; date?: string }, context: z.RefinementCtx) {
  if (value.periodMode === "DAY" && !value.date) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["date"], message: "Date is required when periodMode is DAY" });
  }
  if (value.periodMode === "MONTH" && !value.month) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["month"], message: "Month is required when periodMode is MONTH" });
  }
  if (!value.periodMode && value.date) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["periodMode"], message: "periodMode is required when date is supplied" });
  }
}

function queryBoolean(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === undefined) return defaultValue;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.toLowerCase() !== "false";
    return value;
  }, z.boolean());
}

export const transactionInquiryWorkspaceQuerySchema = z.object({
  periodMode: periodModeSchema.optional(),
  month: monthSchema.optional(),
  date: dateSchema.optional(),
  search: z.string().trim().max(150).optional().default(""),
  status: statusSchema.optional().default("ALL"),
  bankAccountId: optionalUuidSchema,
  finalEventId: optionalUuidSchema,
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25)
}).superRefine(validatePeriod);

export const transactionInquiryReportQuerySchema = z.object({
  periodMode: periodModeSchema.optional(),
  month: monthSchema.optional(),
  date: dateSchema.optional(),
  search: z.string().trim().max(150).optional().default(""),
  status: statusSchema.optional().default("ALL"),
  bankAccountId: optionalUuidSchema,
  finalEventId: optionalUuidSchema,
  includeFinancialSummary: queryBoolean(true),
  includeClassificationSummary: queryBoolean(true),
  includeTransactionDetail: queryBoolean(true)
}).superRefine((value, context) => {
  validatePeriod(value, context);
  if (!value.includeFinancialSummary && !value.includeClassificationSummary && !value.includeTransactionDetail) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["includeFinancialSummary"],
      message: "At least one report section must be selected"
    });
  }
});

export const transactionInquiryParamsSchema = z.object({
  transactionId: z.string().uuid()
});

export type TransactionInquiryWorkspaceQuery = z.infer<typeof transactionInquiryWorkspaceQuerySchema>;
export type TransactionInquiryReportQuery = z.infer<typeof transactionInquiryReportQuerySchema>;
