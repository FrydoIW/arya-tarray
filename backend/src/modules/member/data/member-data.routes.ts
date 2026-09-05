import { Router } from "express";
import { asyncHandler, privateErrorHandler } from "../../../lib/http.js";
import * as controller from "./member-data.controller.js";

export const memberDataRouter = Router();
memberDataRouter.get("/workspace", asyncHandler(controller.workspace));
memberDataRouter.get("/identity-options", asyncHandler(controller.options));
memberDataRouter.get("/member-options", asyncHandler(controller.memberOptions));
memberDataRouter.get("/:memberId/donations", asyncHandler(controller.donations));
memberDataRouter.get("/:memberId", asyncHandler(controller.detail));
memberDataRouter.patch("/:memberId", asyncHandler(controller.update));
memberDataRouter.post("/:memberId/identities/:identityId/attach", asyncHandler(controller.attach));
memberDataRouter.post("/:memberId/identities/:identityId/move", asyncHandler(controller.move));
memberDataRouter.post("/:memberId/identities/:identityId/detach", asyncHandler(controller.detach));
memberDataRouter.patch("/:memberId/identities/:identityId", asyncHandler(controller.identityMetadata));

memberDataRouter.use(privateErrorHandler(
  "member-data",
  "Data donatur gagal diproses. Silakan coba lagi."
));
