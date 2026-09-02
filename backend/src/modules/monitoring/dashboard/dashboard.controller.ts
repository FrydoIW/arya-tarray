import type { Request, Response } from "express";
import { dashboardWorkspaceQuerySchema } from "./dashboard.schema.js";
import { getDashboardWorkspace } from "./dashboard.service.js";

export async function getDashboardWorkspaceController(req: Request, res: Response) {
  const query = dashboardWorkspaceQuerySchema.parse(req.query);
  res.json(await getDashboardWorkspace(query, req.auth!.userId));
}
