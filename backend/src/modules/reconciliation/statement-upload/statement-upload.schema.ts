import { z } from "zod";

export const workspaceQuerySchema = z.object({
  statementId: z.string().uuid().optional()
});

export const uploadStatementBodySchema = z.object({
  bankAccountId: z.string().uuid()
});

export const transactionParamsSchema = z.object({
  statementId: z.string().uuid(),
  transactionId: z.string().uuid()
});

export const updateFinalEventSchema = z.object({
  eventCodeId: z.string().uuid().nullable(),
  eventCampaignId: z.string().uuid().nullable().optional().default(null),
  remark: z.string().trim().max(1000).optional()
});

export const statementParamsSchema = z.object({
  statementId: z.string().uuid()
});

export const withdrawStatementSchema = z.object({
  reason: z.string().trim().min(1, "Withdrawal reason is required").max(1000)
});

export type UpdateFinalEventInput = z.infer<typeof updateFinalEventSchema>;
export type WithdrawStatementInput = z.infer<typeof withdrawStatementSchema>;
