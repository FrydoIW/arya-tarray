import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import {
  executeUserWorkspaceController,
  getUserWorkspaceController
} from "./user.controller.js";

export const userRouter = Router();

userRouter.get("/workspace", asyncHandler(getUserWorkspaceController));
userRouter.post("/workspace/execute", asyncHandler(executeUserWorkspaceController));
