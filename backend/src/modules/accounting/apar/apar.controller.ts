import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../../../lib/http.js";
import { adjustmentInputSchema, asOfSchema, cancelSourceSchema, counterpartySchema, counterpartyUpdateSchema,
  documentInputSchema, documentUpdateSchema, matchSettlementSchema, settlementInputSchema, settlementUpdateSchema,
  sourcePostSchema, sourceReversalSchema, sourceSubmitSchema, subledgerListSchema, type DocumentKind } from "./apar.schema.js";
import * as service from "./apar.service.js";
function actor(req: Request) { if (!req.auth?.userId) throw new HttpError(401, "Authentication required"); return req.auth.userId; }
const id = (req: Request) => z.string().uuid().parse(req.params.id);
export async function listCounterpartiesController(req: Request, res: Response) {
  res.json(await service.listCounterparties(actor(req), subledgerListSchema.parse(req.query)));
}
export async function createCounterpartyController(req: Request, res: Response) {
  res.status(201).json(await service.createCounterparty(actor(req), counterpartySchema.parse(req.body)));
}
export async function getCounterpartyController(req: Request, res: Response) { res.json(await service.getCounterparty(actor(req), id(req))); }
export async function updateCounterpartyController(req: Request, res: Response) {
  res.json(await service.updateCounterparty(actor(req), id(req), counterpartyUpdateSchema.parse(req.body)));
}
export function subledgerControllers(kind: DocumentKind) {
  return {
    listDocuments: async (req: Request, res: Response) => { res.json(await service.listDocuments(actor(req), kind, subledgerListSchema.parse(req.query))); },
    createDocument: async (req: Request, res: Response) => { res.status(201).json(await service.createDocument(actor(req), kind, documentInputSchema.parse(req.body))); },
    getDocument: async (req: Request, res: Response) => { res.json(await service.getDocument(actor(req), kind, id(req))); },
    updateDocument: async (req: Request, res: Response) => { res.json(await service.updateDocument(actor(req), kind, id(req), documentUpdateSchema.parse(req.body))); },
    cancelDocument: async (req: Request, res: Response) => { const input = cancelSourceSchema.parse(req.body);
      res.json(await service.cancelSource(actor(req), kind, "DOCUMENT", id(req), input.expectedRevision, input.reason)); },
    submitDocument: async (req: Request, res: Response) => { res.status(201).json(await service.submitSource(actor(req), kind, "DOCUMENT", id(req), sourceSubmitSchema.parse(req.body).expectedRevision)); },
    postDocument: async (req: Request, res: Response) => { res.status(201).json(await service.postSource(actor(req), kind, "DOCUMENT", id(req), sourcePostSchema.parse(req.body).approvalRequestId)); },
    reverseDocument: async (req: Request, res: Response) => { res.status(201).json(await service.requestSourceReversal(actor(req), kind, "DOCUMENT", id(req), sourceReversalSchema.parse(req.body))); },
    listSettlements: async (req: Request, res: Response) => { res.json(await service.listSettlements(actor(req), kind, subledgerListSchema.parse(req.query))); },
    createSettlement: async (req: Request, res: Response) => { res.status(201).json(await service.createSettlement(actor(req), kind, settlementInputSchema.parse(req.body))); },
    getSettlement: async (req: Request, res: Response) => { res.json(await service.getSettlement(actor(req), kind, id(req))); },
    updateSettlement: async (req: Request, res: Response) => { res.json(await service.updateSettlement(actor(req), kind, id(req), settlementUpdateSchema.parse(req.body))); },
    cancelSettlement: async (req: Request, res: Response) => { const input = cancelSourceSchema.parse(req.body);
      res.json(await service.cancelSource(actor(req), kind, "SETTLEMENT", id(req), input.expectedRevision, input.reason)); },
    submitSettlement: async (req: Request, res: Response) => { res.status(201).json(await service.submitSource(actor(req), kind, "SETTLEMENT", id(req), sourceSubmitSchema.parse(req.body).expectedRevision)); },
    postSettlement: async (req: Request, res: Response) => { res.status(201).json(await service.postSource(actor(req), kind, "SETTLEMENT", id(req), sourcePostSchema.parse(req.body).approvalRequestId)); },
    reverseSettlement: async (req: Request, res: Response) => { res.status(201).json(await service.requestSourceReversal(actor(req), kind, "SETTLEMENT", id(req), sourceReversalSchema.parse(req.body))); },
    matchSettlement: async (req: Request, res: Response) => { const input = matchSettlementSchema.parse(req.body);
      res.json(await service.matchSettlement(actor(req), kind, id(req), input.bankTransactionId, input.remark)); },
    outstanding: async (req: Request, res: Response) => { res.json(await service.outstandingReport(actor(req), kind, asOfSchema.parse(req.query))); },
    controlReconciliation: async (req: Request, res: Response) => { res.json(await service.controlReconciliation(actor(req), kind, asOfSchema.parse(req.query))); },
    requestAdjustment: async (req: Request, res: Response) => { res.status(201).json(await service.requestArAdjustment(actor(req), id(req), adjustmentInputSchema.parse(req.body))); }
  };
}
