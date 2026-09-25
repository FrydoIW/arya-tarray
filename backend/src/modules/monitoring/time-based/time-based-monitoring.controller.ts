import type { Request, Response } from "express";
import { timeBasedMonitoringQuerySchema } from "./time-based-monitoring.schema.js";
import { getTimeBasedMonitoringWorkspace } from "./time-based-monitoring.service.js";
export async function getTimeBasedMonitoringWorkspaceController(req: Request, res: Response) { res.json(await getTimeBasedMonitoringWorkspace(timeBasedMonitoringQuerySchema.parse(req.query))); }
