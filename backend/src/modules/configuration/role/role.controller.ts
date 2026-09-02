import type { Request, Response } from "express";
import { roleListSchema, roleWorkspaceExecuteSchema } from "./role.schema.js";
import { executeRoleWorkspace, getRoleWorkspace, listRoles } from "./role.service.js";

export async function listRolesController(req: Request, res: Response) {
  const query = roleListSchema.parse(req.query);
  res.json(await listRoles(query.search));
}

export async function getRoleWorkspaceController(_req: Request, res: Response) {
  res.json(await getRoleWorkspace());
}

export async function executeRoleWorkspaceController(req: Request, res: Response) {
  const input = roleWorkspaceExecuteSchema.parse(req.body);
  res.json(await executeRoleWorkspace(input, req.auth!.userId));
}
