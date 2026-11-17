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
  listChildrenController,
  executeChildrenController,
  previewEventCodeBulkUploadController
} from "./event-code.controller.js";
import * as itemSaleController from "../../item-sale/item-sale.controller.js";

export const eventCodeRouter = Router();
const eventCodeUpload = createMemoryUpload(5);

eventCodeRouter.get("/", asyncHandler(listEventCodesController));
eventCodeRouter.get("/campaigns", asyncHandler(listCampaignsController));
eventCodeRouter.post("/campaigns/execute", asyncHandler(executeCampaignsController));
eventCodeRouter.get("/time-rules", asyncHandler(listTimeRulesController));
eventCodeRouter.post("/time-rules/execute", asyncHandler(executeTimeRuleController));
eventCodeRouter.get("/children", asyncHandler(listChildrenController));
eventCodeRouter.post("/children/execute", asyncHandler(executeChildrenController));
eventCodeRouter.get("/children/:childId/item-sale", asyncHandler(itemSaleController.detail));
eventCodeRouter.post("/children/:childId/item-sale/configure", asyncHandler(itemSaleController.configure));
eventCodeRouter.patch("/children/:childId/item-sale/price", asyncHandler(itemSaleController.price));
eventCodeRouter.post("/children/:childId/item-sale/stock-adjustments", asyncHandler(itemSaleController.stock));
eventCodeRouter.get("/template", asyncHandler(downloadEventCodeTemplateController));
eventCodeRouter.post("/bulk-preview", eventCodeUpload.single("file"), asyncHandler(previewEventCodeBulkUploadController));
eventCodeRouter.post("/execute", asyncHandler(executeEventCodeChangesController));
