import type { Request, Response } from "express";
import {
  approveDecisionSchema,
  rejectDecisionSchema,
  signApprovalParamsSchema
} from "./sign-approval.schema.js";
import {
  approveSignApproval,
  getSignApprovalDetail,
  getSignApprovalWorkspace,
  rejectSignApproval
} from "./sign-approval.service.js";

export async function getSignApprovalWorkspaceController(req: Request, res: Response) {
  res.json(await getSignApprovalWorkspace(req.auth!.userId));
}

export async function getSignApprovalDetailController(req: Request, res: Response) {
  const { approvalId } = signApprovalParamsSchema.parse(req.params);
  res.json(await getSignApprovalDetail(approvalId, req.auth!.userId));
}

export async function approveSignApprovalController(req: Request, res: Response) {
  const { approvalId } = signApprovalParamsSchema.parse(req.params);
  const input = approveDecisionSchema.parse(req.body ?? {});
  res.json(await approveSignApproval(approvalId, input, req.auth!.userId));
}

export async function rejectSignApprovalController(req: Request, res: Response) {
  const { approvalId } = signApprovalParamsSchema.parse(req.params);
  const input = rejectDecisionSchema.parse(req.body ?? {});
  res.json(await rejectSignApproval(approvalId, input, req.auth!.userId));
}
