import { z } from "zod";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must use YYYY-MM format");

export const editIncomeWorkspaceQuerySchema = z.object({
  month: monthSchema.optional()
});

export const editIncomeStatementParamsSchema = z.object({
  statementId: z.string().uuid()
});

const correctionSchema = z.object({
  transactionId: z.string().uuid(),
  eventCodeId: z.string().uuid().nullable(),
  remark: z.string().trim().max(1000).nullable()
});

export const executeEditIncomeSchema = z.object({
  changes: z.array(correctionSchema).min(1).max(5000)
}).superRefine((value, context) => {
  const ids = new Set<string>();
  value.changes.forEach((change, index) => {
    if (ids.has(change.transactionId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["changes", index, "transactionId"],
        message: "Duplicate transaction correction is not allowed"
      });
    }
    ids.add(change.transactionId);
  });
});

export type EditIncomeWorkspaceQuery = z.infer<typeof editIncomeWorkspaceQuerySchema>;
export type ExecuteEditIncomeInput = z.infer<typeof executeEditIncomeSchema>;
