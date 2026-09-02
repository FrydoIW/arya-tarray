import type { Request, Response } from "express";
import { userWorkspaceExecuteSchema } from "./user.schema.js";
import { executeUserWorkspace, getUserWorkspace } from "./user.service.js";

export async function getUserWorkspaceController(_req: Request, res: Response) {
  res.json(await getUserWorkspace());
}

export async function executeUserWorkspaceController(req: Request, res: Response) {
  const input = userWorkspaceExecuteSchema.parse(req.body);
  res.json(await executeUserWorkspace(input, req.auth!.userId));
}
