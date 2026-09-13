import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import { createMemoryUpload } from "../../../middleware/upload.js";
import {
  downloadEventCodeTemplateController,
  executeEventCodeChangesController,
  listEventCodesController,
  listCampaignsController,
  executeCampaignsController,
  executeTimeRuleController,
  listTimeRulesController,
  previewEventCodeBulkUploadController
} from "./event-code.controller.js";

export const eventCodeRouter = Router();
const eventCodeUpload = createMemoryUpload(5);

eventCodeRouter.get("/", asyncHandler(listEventCodesController));
eventCodeRouter.get("/campaigns", asyncHandler(listCampaignsController));
eventCodeRouter.post("/campaigns/execute", asyncHandler(executeCampaignsController));
eventCodeRouter.get("/time-rules", asyncHandler(listTimeRulesController));
eventCodeRouter.post("/time-rules/execute", asyncHandler(executeTimeRuleController));
eventCodeRouter.get("/template", asyncHandler(downloadEventCodeTemplateController));
eventCodeRouter.post("/bulk-preview", eventCodeUpload.single("file"), asyncHandler(previewEventCodeBulkUploadController));
eventCodeRouter.post("/execute", asyncHandler(executeEventCodeChangesController));
