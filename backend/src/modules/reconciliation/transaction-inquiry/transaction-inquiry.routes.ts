import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import {
  getTransactionInquiryDetailController,
  getTransactionInquiryReportController,
  getTransactionInquiryWorkspaceController
} from "./transaction-inquiry.controller.js";

export const transactionInquiryRouter = Router();

transactionInquiryRouter.get("/workspace", asyncHandler(getTransactionInquiryWorkspaceController));
transactionInquiryRouter.get("/report", asyncHandler(getTransactionInquiryReportController));
transactionInquiryRouter.get("/:transactionId", asyncHandler(getTransactionInquiryDetailController));
