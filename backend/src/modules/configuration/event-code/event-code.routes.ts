import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import { createMemoryUpload } from "../../../middleware/upload.js";
import {
  downloadEventCodeTemplateController,
  executeEventCodeChangesController,
  listEventCodesController,
  previewEventCodeBulkUploadController
} from "./event-code.controller.js";

export const eventCodeRouter = Router();
const eventCodeUpload = createMemoryUpload(5);

eventCodeRouter.get("/", asyncHandler(listEventCodesController));
eventCodeRouter.get("/template", asyncHandler(downloadEventCodeTemplateController));
eventCodeRouter.post("/bulk-preview", eventCodeUpload.single("file"), asyncHandler(previewEventCodeBulkUploadController));
eventCodeRouter.post("/execute", asyncHandler(executeEventCodeChangesController));
