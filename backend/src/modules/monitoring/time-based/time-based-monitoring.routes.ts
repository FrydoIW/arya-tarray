import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import { getTimeBasedMonitoringWorkspaceController } from "./time-based-monitoring.controller.js";
export const timeBasedMonitoringRouter = Router();
timeBasedMonitoringRouter.get("/workspace", asyncHandler(getTimeBasedMonitoringWorkspaceController));
