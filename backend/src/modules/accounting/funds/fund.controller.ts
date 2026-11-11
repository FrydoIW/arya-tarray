import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../../../lib/http.js";
import { submitApproval } from "../approval/approval.service.js";
import { sourceSubmitSchema, sourcePostSchema, cancelSourceSchema } from "../apar/apar.schema.js";
import { fundInputSchema, restrictionInputSchema, designationInputSchema, fundMovementSchema, fundCommandSchema, releaseInputSchema } from "./fund.schema.js";
import { applyFundSource, createFund, reviseFund, createRestriction, reviseRestriction, createDesignation, createFundMovement, createFundCommand, cancelFundDraft } from "./fund.service.js";
import { contributionSources, getFundMetrics, getFundSource, listFunds, listFundChildren, reconcileFund } from "./fund-report.service.js";
function actor(req: Request) { if (!req.auth?.userId) throw new HttpError(401, "Authentication required"); return req.auth.userId; }
const id = (req: Request) => z.string().uuid().parse(req.params.id);
const page = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), status: z.string().trim().max(20).optional(), search: z.string().trim().max(100).optional() });
export const fundController = {
  sources: async (req: Request, res: Response) => { const q = page.extend({ unallocatedOnly: z.enum(["true", "false"]).default("true").transform(v => v === "true") }).parse(req.query); res.json(await contributionSources(actor(req), q)); },
  list: async (req: Request, res: Response) => { res.json(await listFunds(actor(req), page.parse(req.query))); },
  detail: (type: "FUND" | "RESTRICTION" | "DESIGNATION" | "MOVEMENT") => async (req: Request, res: Response) => { res.json(await getFundSource(actor(req), type, id(req))); },
  children: (type: "RESTRICTION" | "DESIGNATION" | "MOVEMENT" | "RELEASE" | "JOURNAL") => async (req: Request, res: Response) => { res.json(await listFundChildren(actor(req), id(req), type, page.parse(req.query))); },
  create: async (req: Request, res: Response) => { res.status(201).json(await createFund(actor(req), fundInputSchema.parse(req.body))); },
  revise: async (req: Request, res: Response) => { const { expectedRevision, ...input } = fundInputSchema.extend({ expectedRevision: z.number().int().positive() }).parse(req.body); res.json(await reviseFund(actor(req), id(req), expectedRevision, input)); },
  restriction: async (req: Request, res: Response) => { res.status(201).json(await createRestriction(actor(req), id(req), restrictionInputSchema.parse(req.body))); },
  reviseRestriction: async (req: Request, res: Response) => { const { expectedRevision, ...input } = restrictionInputSchema.extend({ expectedRevision: z.number().int().positive() }).parse(req.body); res.json(await reviseRestriction(actor(req), id(req), expectedRevision, input)); },
  designation: async (req: Request, res: Response) => { res.status(201).json(await createDesignation(actor(req), id(req), designationInputSchema.parse(req.body))); },
  movement: async (req: Request, res: Response) => { res.status(201).json(await createFundMovement(actor(req), id(req), fundMovementSchema.parse(req.body))); },
  command: async (req: Request, res: Response) => { res.status(201).json(await createFundCommand(actor(req), id(req), fundCommandSchema.parse(req.body))); },
  submit: (kind: "FUND_SETUP" | "FUND_RESTRICTION" | "FUND_DESIGNATION") => async (req: Request, res: Response) => { res.status(201).json(await submitApproval(actor(req), { kind, sourceDocumentId: id(req), expectedRevision: sourceSubmitSchema.parse(req.body).expectedRevision })); },
  submitMovement: async (req: Request, res: Response) => { const q = sourceSubmitSchema.extend({ kind: z.enum(["FUND_COMMAND", "FUND_JOURNAL"]) }).parse(req.body); res.status(201).json(await submitApproval(actor(req), { ...q, sourceDocumentId: id(req) })); },
  release: async (req: Request, res: Response) => { const { expectedRevision, ...release } = releaseInputSchema.extend({ expectedRevision: z.number().int().positive() }).parse(req.body); res.status(201).json(await submitApproval(actor(req), { kind: "FUND_RELEASE", sourceDocumentId: id(req), expectedRevision, release })); },
  apply: async (req: Request, res: Response) => { res.status(201).json(await applyFundSource(actor(req), id(req), sourcePostSchema.parse(req.body).approvalRequestId)); },
  cancel: (type: "RESTRICTION" | "DESIGNATION" | "MOVEMENT") => async (req: Request, res: Response) => { const q = cancelSourceSchema.parse(req.body); res.json(await cancelFundDraft(actor(req), type, id(req), q.expectedRevision, q.reason)); },
  balances: async (req: Request, res: Response) => { res.json(await getFundMetrics(actor(req), id(req))); },
  reconciliation: async (req: Request, res: Response) => { res.json(await reconcileFund(actor(req), id(req))); }
};
