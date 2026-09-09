import { z } from "zod";
import { isValidPeriodDate } from "../../../lib/period.js";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must use YYYY-MM format");
const dateSchema = z.string().refine(isValidPeriodDate, "Date must use YYYY-MM-DD format");

export const editIncomeWorkspaceQuerySchema = z.object({
  periodMode: z.enum(["MONTH", "DAY"]).optional(),
  month: monthSchema.optional(),
  date: dateSchema.optional()
}).superRefine((value, context) => {
  if (value.periodMode === "DAY" && !value.date) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["date"], message: "Date is required when periodMode is DAY" });
  }
  if (value.periodMode === "MONTH" && !value.month) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["month"], message: "Month is required when periodMode is MONTH" });
  }
  if (!value.periodMode && value.date) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["periodMode"], message: "periodMode is required when date is supplied" });
  }
});

export const editIncomeStatementParamsSchema = z.object({
  statementId: z.string().uuid()
});

const modifiedCorrectionSchema = z.object({
  action: z.literal("MODIFIED"),
  transactionId: z.string().uuid(),
  eventCodeId: z.string().uuid().nullable(),
  remark: z.string().trim().max(1000).nullable()
});

const excludedCorrectionSchema = z.object({
  action: z.literal("EXCLUDED"),
  transactionId: z.string().uuid(),
  reason: z.string().trim().min(1, "Correction Reason is required").max(1000)
});

const addedCorrectionSchema = z.object({
  action: z.literal("ADDED"),
  clientId: z.string().uuid(),
  direction: z.enum(["INCOMING", "OUTGOING"]),
  transactionDate: dateSchema,
  description: z.string().trim().min(1, "Description is required").max(2000),
  amount: z.string().regex(/^\d{1,18}(?:\.\d{1,2})?$/, "Amount must be a positive value with at most 2 decimals")
    .refine((value) => Number(value) > 0, "Amount must be greater than zero"),
  eventCodeId: z.string().uuid().nullable(),
  remark: z.string().trim().max(1000).nullable(),
  reason: z.string().trim().min(1, "Correction Reason is required").max(1000)
});

const correctionSchema = z.discriminatedUnion("action", [
  modifiedCorrectionSchema,
  excludedCorrectionSchema,
  addedCorrectionSchema
]);

export const executeEditIncomeSchema = z.object({
  corrections: z.array(correctionSchema).min(1).max(5000)
}).superRefine((value, context) => {
  const ids = new Set<string>();
  value.corrections.forEach((change, index) => {
    if (change.action === "ADDED" && change.direction === "INCOMING" && !change.eventCodeId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["corrections", index, "eventCodeId"], message: "Final Event is required for an incoming adjustment" });
    }
    if (change.action === "ADDED" && change.direction === "OUTGOING" && change.eventCodeId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["corrections", index, "eventCodeId"], message: "Final Event is not applicable to an outgoing adjustment" });
    }
    const identity = change.action === "ADDED" ? `ADDED:${change.clientId}` : `EXISTING:${change.transactionId}`;
    if (ids.has(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["corrections", index],
        message: "Duplicate transaction correction is not allowed"
      });
    }
    ids.add(identity);
  });
});

export type EditIncomeWorkspaceQuery = z.infer<typeof editIncomeWorkspaceQuerySchema>;
export type ExecuteEditIncomeInput = z.infer<typeof executeEditIncomeSchema>;
