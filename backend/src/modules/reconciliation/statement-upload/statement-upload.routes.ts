import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import { createMemoryUpload } from "../../../middleware/upload.js";
import {
  executeStatementController,
  getStatementUploadWorkspaceController,
  updateFinalEventController,
  uploadStatementController,
  withdrawStatementController
} from "./statement-upload.controller.js";

export const statementUploadRouter = Router();
const statementUpload = createMemoryUpload(50);

statementUploadRouter.get("/workspace", asyncHandler(getStatementUploadWorkspaceController));
statementUploadRouter.post("/upload", statementUpload.single("file"), asyncHandler(uploadStatementController));
statementUploadRouter.patch(
  "/:statementId/transactions/:transactionId/final-event",
  asyncHandler(updateFinalEventController)
);
statementUploadRouter.post("/:statementId/execute", asyncHandler(executeStatementController));
statementUploadRouter.post("/:statementId/withdraw", asyncHandler(withdrawStatementController));
