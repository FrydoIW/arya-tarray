import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import {
  executeEditIncomeController,
  getEditIncomeDetailController,
  getEditIncomeWorkspaceController
} from "./edit-income.controller.js";

export const editIncomeRouter = Router();

editIncomeRouter.get("/workspace", asyncHandler(getEditIncomeWorkspaceController));
editIncomeRouter.get("/:statementId", asyncHandler(getEditIncomeDetailController));
editIncomeRouter.post("/:statementId/execute", asyncHandler(executeEditIncomeController));
