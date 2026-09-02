import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import {
  executeEventCodeChangesController,
  listEventCodesController
} from "./event-code.controller.js";

export const eventCodeRouter = Router();

eventCodeRouter.get("/", asyncHandler(listEventCodesController));
eventCodeRouter.post("/execute", asyncHandler(executeEventCodeChangesController));
