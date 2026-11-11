import { Router } from "express";
import { asyncHandler } from "../../../lib/http.js";
import { requireMenuAccess } from "../../../middleware/authorization.js";
import { ACCOUNTING_POST } from "../approval/approval.repository.js";
import { managementCode, SETTLEMENT_MATCH } from "./apar.domain.js";
import type { DocumentKind } from "./apar.schema.js";
import { createCounterpartyController, getCounterpartyController, listCounterpartiesController,
  subledgerControllers, updateCounterpartyController } from "./apar.controller.js";

function subledgerRouter(kind: DocumentKind) {
  const router = Router(), controllers = subledgerControllers(kind), manage = requireMenuAccess(managementCode(kind));
  router.get("/documents", asyncHandler(controllers.listDocuments));
  router.post("/documents", manage, asyncHandler(controllers.createDocument));
  router.get("/documents/:id", asyncHandler(controllers.getDocument));
  router.patch("/documents/:id", manage, asyncHandler(controllers.updateDocument));
  router.post("/documents/:id/cancel", manage, asyncHandler(controllers.cancelDocument));
  router.post("/documents/:id/submit", manage, asyncHandler(controllers.submitDocument));
  router.post("/documents/:id/post", requireMenuAccess(ACCOUNTING_POST), asyncHandler(controllers.postDocument));
  router.post("/documents/:id/reversal-requests", manage, asyncHandler(controllers.reverseDocument));
  if (kind === "RECEIVABLE") router.post("/documents/:id/adjustments", manage, asyncHandler(controllers.requestAdjustment));
  router.get("/settlements", asyncHandler(controllers.listSettlements));
  router.post("/settlements", manage, asyncHandler(controllers.createSettlement));
  router.get("/settlements/:id", asyncHandler(controllers.getSettlement));
  router.patch("/settlements/:id", manage, asyncHandler(controllers.updateSettlement));
  router.post("/settlements/:id/cancel", manage, asyncHandler(controllers.cancelSettlement));
  router.post("/settlements/:id/submit", manage, asyncHandler(controllers.submitSettlement));
  router.post("/settlements/:id/post", requireMenuAccess(ACCOUNTING_POST), asyncHandler(controllers.postSettlement));
  router.post("/settlements/:id/reversal-requests", manage, asyncHandler(controllers.reverseSettlement));
  router.post("/settlements/:id/match", requireMenuAccess(SETTLEMENT_MATCH), asyncHandler(controllers.matchSettlement));
  router.get("/outstanding", asyncHandler(controllers.outstanding));
  router.get("/aging", asyncHandler(controllers.outstanding));
  router.get("/control-reconciliation", asyncHandler(controllers.controlReconciliation));
  return router;
}
export const aparRouter = Router();
aparRouter.get("/counterparties", asyncHandler(listCounterpartiesController));
aparRouter.post("/counterparties", asyncHandler(createCounterpartyController));
aparRouter.get("/counterparties/:id", asyncHandler(getCounterpartyController));
aparRouter.patch("/counterparties/:id", asyncHandler(updateCounterpartyController));
aparRouter.use("/ap", subledgerRouter("PAYABLE"));
aparRouter.use("/ar", subledgerRouter("RECEIVABLE"));
