import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import {
  executeEditIncomeController,
  getEditIncomeDetailController,
  getEditIncomeWorkspaceController
} from "./edit-income.controller.js";
import { retry as retryItemSalePurchaseController } from "../../item-sale/item-sale.controller.js";

export const editIncomeRouter = Router();

editIncomeRouter.get("/workspace", asyncHandler(getEditIncomeWorkspaceController));
editIncomeRouter.get("/:statementId", asyncHandler(getEditIncomeDetailController));
editIncomeRouter.post("/:statementId/execute", asyncHandler(executeEditIncomeController));
editIncomeRouter.post("/transactions/:transactionId/item-sale/retry", asyncHandler(retryItemSalePurchaseController));
