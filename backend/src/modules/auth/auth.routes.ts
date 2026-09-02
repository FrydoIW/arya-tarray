import { Router } from "express";
import { asyncHandler } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireActiveUser } from "../../middleware/authorization.js";
import { loginController, meController } from "./auth.controller.js";

export const authRouter = Router();

authRouter.post("/login", asyncHandler(loginController));
authRouter.get("/me", requireAuth, requireActiveUser, asyncHandler(meController));
