import { z } from "zod";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must use YYYY-MM format");
const statusSchema = z.enum(["ALL", "RAW", "CHECK", "FINALIZED"]);
const optionalUuidSchema = z.string().uuid().optional();

function queryBoolean(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === undefined) return defaultValue;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.toLowerCase() !== "false";
    return value;
  }, z.boolean());
}

export const transactionInquiryWorkspaceQuerySchema = z.object({
  month: monthSchema.optional(),
  search: z.string().trim().max(150).optional().default(""),
  status: statusSchema.optional().default("ALL"),
  bankAccountId: optionalUuidSchema,
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25)
});

export const transactionInquiryReportQuerySchema = z.object({
  month: monthSchema.optional(),
  search: z.string().trim().max(150).optional().default(""),
  status: statusSchema.optional().default("ALL"),
  bankAccountId: optionalUuidSchema,
  includeFinancialSummary: queryBoolean(true),
  includeClassificationSummary: queryBoolean(true),
  includeTransactionDetail: queryBoolean(true)
}).superRefine((value, context) => {
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
