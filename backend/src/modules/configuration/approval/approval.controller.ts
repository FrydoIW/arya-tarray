import type { Request, Response } from "express";
import { approvalWorkspaceExecuteSchema } from "./approval.schema.js";
import { executeApprovalWorkspace, getApprovalWorkspace } from "./approval.service.js";

export async function getApprovalWorkspaceController(_req: Request, res: Response) {
  res.json(await getApprovalWorkspace());
}

export async function executeApprovalWorkspaceController(req: Request, res: Response) {
  const input = approvalWorkspaceExecuteSchema.parse(req.body);
  res.json(await executeApprovalWorkspace(input, req.auth!.userId));
}
