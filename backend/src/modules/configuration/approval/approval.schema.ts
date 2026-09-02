import { z } from "zod";

const id = z.string().trim().min(1);
const approverUserIds = z.array(id).min(1, "Minimal satu approver wajib dipilih");

const approvalCreateSchema = z.object({
  clientId: id,
  menuId: id,
  approverUserIds,
  activeFlag: z.boolean()
});

const approvalUpdateSchema = z.object({
  id,
  input: z.object({
    approverUserIds,
    activeFlag: z.boolean()
  })
});

export const approvalWorkspaceExecuteSchema = z.object({
  creates: z.array(approvalCreateSchema).default([]),
  updates: z.array(approvalUpdateSchema).default([])
});

export type ApprovalWorkspaceExecuteInput = z.infer<typeof approvalWorkspaceExecuteSchema>;
