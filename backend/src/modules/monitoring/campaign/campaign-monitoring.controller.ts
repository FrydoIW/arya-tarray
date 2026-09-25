import type { Request, Response } from "express";
import { campaignMonitoringQuerySchema } from "./campaign-monitoring.schema.js";
import { getCampaignMonitoringWorkspace } from "./campaign-monitoring.service.js";
export async function getCampaignMonitoringWorkspaceController(req: Request, res: Response) { res.json(await getCampaignMonitoringWorkspace(campaignMonitoringQuerySchema.parse(req.query))); }
