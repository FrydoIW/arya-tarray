import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import {
  executeBankAccountWorkspaceController,
  getBankAccountWorkspaceController
} from "./bank-account.controller.js";

export const bankAccountRouter = Router();

bankAccountRouter.get("/workspace", asyncHandler(getBankAccountWorkspaceController));
bankAccountRouter.post("/workspace/execute", asyncHandler(executeBankAccountWorkspaceController));
