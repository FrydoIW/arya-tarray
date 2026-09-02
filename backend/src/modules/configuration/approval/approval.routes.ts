import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import {
  executeApprovalWorkspaceController,
  getApprovalWorkspaceController
} from "./approval.controller.js";

export const approvalRouter = Router();

approvalRouter.get("/workspace", asyncHandler(getApprovalWorkspaceController));
approvalRouter.post("/workspace/execute", asyncHandler(executeApprovalWorkspaceController));
