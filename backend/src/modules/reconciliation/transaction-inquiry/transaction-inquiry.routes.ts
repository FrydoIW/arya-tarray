import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import {
  getTransactionInquiryDetailController,
  getTransactionInquiryMemberOptionsController,
  getTransactionInquiryReportController,
  getTransactionInquiryWorkspaceController
} from "./transaction-inquiry.controller.js";

export const transactionInquiryRouter = Router();

transactionInquiryRouter.get("/workspace", asyncHandler(getTransactionInquiryWorkspaceController));
transactionInquiryRouter.get("/member-options", asyncHandler(getTransactionInquiryMemberOptionsController));
transactionInquiryRouter.get("/report", asyncHandler(getTransactionInquiryReportController));
transactionInquiryRouter.get("/:transactionId", asyncHandler(getTransactionInquiryDetailController));
