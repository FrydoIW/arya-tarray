import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import {
  approveSignApprovalController,
  getSignApprovalDetailController,
  getSignApprovalWorkspaceController,
  rejectSignApprovalController
} from "./sign-approval.controller.js";

export const signApprovalRouter = Router();

signApprovalRouter.get("/workspace", asyncHandler(getSignApprovalWorkspaceController));
signApprovalRouter.get("/:approvalId", asyncHandler(getSignApprovalDetailController));
signApprovalRouter.post("/:approvalId/approve", asyncHandler(approveSignApprovalController));
signApprovalRouter.post("/:approvalId/reject", asyncHandler(rejectSignApprovalController));
