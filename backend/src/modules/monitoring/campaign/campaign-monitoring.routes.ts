import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import { getCampaignMonitoringWorkspaceController } from "./campaign-monitoring.controller.js";
export const campaignMonitoringRouter = Router();
campaignMonitoringRouter.get("/workspace", asyncHandler(getCampaignMonitoringWorkspaceController));
