import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import { requireMenuAccess } from "../../../middleware/authorization.js";
import { createFiscalYearController, createPeriodController, listFiscalYearsController } from "./period.controller.js";

export const periodRouter = Router();
periodRouter.get("/fiscal-years", asyncHandler(listFiscalYearsController));
periodRouter.post("/fiscal-years", requireMenuAccess("ACCOUNTING_PERIOD_MANAGE"), asyncHandler(createFiscalYearController));
periodRouter.post("/", requireMenuAccess("ACCOUNTING_PERIOD_MANAGE"), asyncHandler(createPeriodController));
