import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import { getDashboardWorkspaceController } from "./dashboard.controller.js";

export const dashboardRouter = Router();

dashboardRouter.get("/workspace", asyncHandler(getDashboardWorkspaceController));
