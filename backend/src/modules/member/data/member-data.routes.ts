import { Router } from "express";
import { asyncHandler, privateErrorHandler } from "../../../lib/http.js";
import { requireMenuAccess } from "../../../middleware/authorization.js";
import * as controller from "./member-data.controller.js";

export const memberDataRouter = Router();
const requireMemberMutationAccess = requireMenuAccess("MEMBER_REGISTRATION");

memberDataRouter.get("/workspace", asyncHandler(controller.workspace));
memberDataRouter.get("/identity-options", requireMemberMutationAccess, asyncHandler(controller.options));
memberDataRouter.get("/member-options", requireMemberMutationAccess, asyncHandler(controller.memberOptions));
memberDataRouter.get("/:memberId/donations", asyncHandler(controller.donations));
memberDataRouter.get("/:memberId/sponsorship", asyncHandler(controller.sponsorship));
memberDataRouter.get("/:memberId/carry-transfers", asyncHandler(controller.carryTransfers));
memberDataRouter.get("/:memberId/identity-history", asyncHandler(controller.identityHistory));
memberDataRouter.get("/:memberId", asyncHandler(controller.detail));
memberDataRouter.patch("/:memberId/lifecycle", requireMemberMutationAccess, asyncHandler(controller.lifecycle));
memberDataRouter.patch("/:memberId", requireMemberMutationAccess, asyncHandler(controller.update));
memberDataRouter.post("/:memberId/identities/:identityId/attach", requireMemberMutationAccess, asyncHandler(controller.attach));
memberDataRouter.post("/:memberId/identities/:identityId/move", requireMemberMutationAccess, asyncHandler(controller.move));
memberDataRouter.post("/:memberId/identities/:identityId/detach", requireMemberMutationAccess, asyncHandler(controller.detach));
memberDataRouter.patch("/:memberId/identities/:identityId", requireMemberMutationAccess, asyncHandler(controller.identityMetadata));
memberDataRouter.post("/:memberId/subscriptions", requireMemberMutationAccess, asyncHandler(controller.createSubscription));
memberDataRouter.post("/:memberId/campaign-participations", requireMemberMutationAccess, asyncHandler(controller.createCampaignParticipation));
memberDataRouter.patch("/:memberId/subscriptions/:subscriptionId", requireMemberMutationAccess, asyncHandler(controller.updateSubscription));
memberDataRouter.post("/:memberId/subscriptions/:subscriptionId/allocate", requireMemberMutationAccess, asyncHandler(controller.allocateSubscription));
memberDataRouter.post("/:memberId/subscriptions/:subscriptionId/opening-coverage", requireMemberMutationAccess, asyncHandler(controller.openingCoverage));
memberDataRouter.post("/:memberId/subscriptions/:subscriptionId/opening-coverage/:coverageId/void", requireMemberMutationAccess, asyncHandler(controller.voidOpeningCoverage));
memberDataRouter.post("/:memberId/subscriptions/:subscriptionId/retry-allocation", requireMemberMutationAccess, asyncHandler(controller.retryAllocation));
memberDataRouter.post("/:memberId/subscriptions/:sourceSubscriptionId/carry-transfers", requireMemberMutationAccess, asyncHandler(controller.createCarryTransfer));
memberDataRouter.post("/:memberId/campaigns/:sourceCampaignId/carry-transfers", requireMemberMutationAccess, asyncHandler(controller.createCampaignWalletTransfer));
memberDataRouter.post("/:memberId/carry-transfers/:transferId/reverse", requireMemberMutationAccess, asyncHandler(controller.reverseCarryTransfer));

memberDataRouter.use(privateErrorHandler(
  "member-data",
  "Data donatur gagal diproses. Silakan coba lagi."
));
