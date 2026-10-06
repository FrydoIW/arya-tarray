import { Router } from "express";
import { asyncHandler, privateErrorHandler } from "../../lib/http.js";
import { accountingExportController, accountingJournalController, accountingReportController, accountingOptionsController } from "./accounting.controller.js";

export const accountingRouter = Router();
accountingRouter.get("/options", asyncHandler(accountingOptionsController));
accountingRouter.get("/reports", asyncHandler(accountingReportController));
accountingRouter.get("/export", asyncHandler(accountingExportController));
accountingRouter.get("/journals/:journalId", asyncHandler(accountingJournalController));
accountingRouter.use(privateErrorHandler("accounting", "Accounting request could not be processed."));
