import { z } from "zod";

export const signApprovalParamsSchema = z.object({
  approvalId: z.string().trim().uuid("Invalid approval request id")
});

const optionalRemark = z
  .string()
  .trim()
  .max(1000, "Remark maksimal 1000 karakter")
  .optional()
  .transform((value) => value || undefined);

export const approveDecisionSchema = z.object({
  remark: optionalRemark
});

export const rejectDecisionSchema = z.object({
  remark: z
    .string()
    .trim()
    .min(1, "Remark wajib diisi untuk reject")
    .max(1000, "Remark maksimal 1000 karakter")
});

export type ApproveDecisionInput = z.infer<typeof approveDecisionSchema>;
export type RejectDecisionInput = z.infer<typeof rejectDecisionSchema>;
