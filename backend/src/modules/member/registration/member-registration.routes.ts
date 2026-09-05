import { Router } from "express";
import { asyncHandler, privateErrorHandler } from "../../../lib/http.js";
import * as controller from "./member-registration.controller.js";
export const memberRegistrationRouter = Router();
memberRegistrationRouter.get("/workspace", asyncHandler(controller.workspace));
memberRegistrationRouter.get("/member-options", asyncHandler(controller.options));
memberRegistrationRouter.post("/manual", asyncHandler(controller.manual));
memberRegistrationRouter.post("/:identityId/register", asyncHandler(controller.register));
memberRegistrationRouter.post("/:identityId/link", asyncHandler(controller.link));
memberRegistrationRouter.post("/:identityId/ignore", asyncHandler(controller.ignore));

memberRegistrationRouter.use(privateErrorHandler(
  "member-registration",
  "Registrasi donatur gagal. Silakan coba lagi."
));
