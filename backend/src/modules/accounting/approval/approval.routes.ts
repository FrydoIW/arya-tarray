import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import { requireMenuAccess } from "../../../middleware/authorization.js";
import { ACCOUNTING_APPROVE, ACCOUNTING_MANAGE, ACCOUNTING_POST } from "./approval.repository.js";
import { cancelApprovalController, createDraftController, decideApprovalController, getApprovalController,
  getDraftController, listApprovalsController, listDraftsController, postApprovalController,
  submitApprovalController, updateDraftController, getApprovalSettingsController, updateApprovalSettingsController } from "./approval.controller.js";

export const accountingApprovalRouter = Router();
accountingApprovalRouter.get("/approval-settings", requireMenuAccess("CONFIG_APPROVAL"), asyncHandler(getApprovalSettingsController));
accountingApprovalRouter.put("/approval-settings", requireMenuAccess("CONFIG_APPROVAL"), asyncHandler(updateApprovalSettingsController));
accountingApprovalRouter.get("/journal-drafts", requireMenuAccess(ACCOUNTING_MANAGE), asyncHandler(listDraftsController));
accountingApprovalRouter.post("/journal-drafts", requireMenuAccess(ACCOUNTING_MANAGE), asyncHandler(createDraftController));
accountingApprovalRouter.get("/journal-drafts/:id", requireMenuAccess(ACCOUNTING_MANAGE), asyncHandler(getDraftController));
accountingApprovalRouter.patch("/journal-drafts/:id", requireMenuAccess(ACCOUNTING_MANAGE), asyncHandler(updateDraftController));
accountingApprovalRouter.get("/approvals", asyncHandler(listApprovalsController));
accountingApprovalRouter.post("/approvals", asyncHandler(submitApprovalController));
accountingApprovalRouter.get("/approvals/:id", asyncHandler(getApprovalController));
accountingApprovalRouter.post("/approvals/:id/decision", requireMenuAccess(ACCOUNTING_APPROVE), asyncHandler(decideApprovalController));
accountingApprovalRouter.post("/approvals/:id/cancel", asyncHandler(cancelApprovalController));
accountingApprovalRouter.post("/approvals/:id/post", requireMenuAccess(ACCOUNTING_POST), asyncHandler(postApprovalController));
