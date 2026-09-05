import { Router, type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { asyncHandler, HttpError } from "../../../lib/http.js";
import * as controller from "./member-registration.controller.js";
export const memberRegistrationRouter = Router();
memberRegistrationRouter.get("/workspace", asyncHandler(controller.workspace));
memberRegistrationRouter.get("/member-options", asyncHandler(controller.options));
memberRegistrationRouter.post("/manual", asyncHandler(controller.manual));
memberRegistrationRouter.post("/:identityId/register", asyncHandler(controller.register));
memberRegistrationRouter.post("/:identityId/link", asyncHandler(controller.link));
memberRegistrationRouter.post("/:identityId/ignore", asyncHandler(controller.ignore));

// Prisma errors can include submitted PII in their rendered arguments. Sanitize before
// the shared error handler logs them, while preserving normal validation/conflict responses.
const privateErrorHandler: ErrorRequestHandler = (error, _req, _res, next) => {
  next(error instanceof HttpError || error instanceof ZodError
    ? error
    : new HttpError(500, "Registrasi donatur gagal. Silakan coba lagi."));
};
memberRegistrationRouter.use(privateErrorHandler);
