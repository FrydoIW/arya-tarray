import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import {
  executeRoleWorkspaceController,
  getRoleWorkspaceController,
  listRolesController
} from "./role.controller.js";

export const roleRouter = Router();

// Lightweight Role master list for future User configuration dropdowns.
roleRouter.get("/", asyncHandler(listRolesController));

// Full Role page workspace: Role Master + Menu Registry + Access Matrix.
roleRouter.get("/workspace", asyncHandler(getRoleWorkspaceController));
roleRouter.post("/workspace/execute", asyncHandler(executeRoleWorkspaceController));
