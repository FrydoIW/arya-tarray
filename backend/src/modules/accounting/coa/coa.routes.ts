import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import { requireMenuAccess } from "../../../middleware/authorization.js";
import { createAccountController, listAccountsController, updateAccountController } from "./coa.controller.js";

export const coaRouter = Router();
coaRouter.get("/", asyncHandler(listAccountsController));
coaRouter.post("/", requireMenuAccess("ACCOUNTING_COA_MANAGE"), asyncHandler(createAccountController));
coaRouter.patch("/:accountId", requireMenuAccess("ACCOUNTING_COA_MANAGE"), asyncHandler(updateAccountController));
