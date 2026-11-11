import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../../../lib/http.js";
import { sourcePostSchema, sourceSubmitSchema, cancelSourceSchema } from "../apar/apar.schema.js";
import { assetInputSchema, categorySchema, assetChangeSchema, runInputSchema } from "./asset.schema.js";
import { createAsset, createCategory, createRun, getAsset, previewRun, refreshRun, reviseAsset, updateCategory } from "./asset.service.js";
import { createAssetChange, refreshAssetChange } from "./asset-change.service.js";
import { applyAssetSource, assetReconciliation, cancelAssetSource, getChange, getRun, listAssetSources, submitAssetSource, getCategory, assetJournals } from "./asset.workflow.js";
function actor(req: Request) { if (!req.auth?.userId) throw new HttpError(401, "Authentication required"); return req.auth.userId; }
const id = (req: Request) => z.string().uuid().parse(req.params.id);
const list = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(), categoryId: z.string().uuid().optional(), status: z.enum(["DRAFT", "ACTIVE", "CANCELLED", "DISPOSED", "WRITTEN_OFF", "POSTED", "VOID"]).optional() });
export const assetController = {
  list: (type: "ASSET" | "RUN" | "CATEGORY") => async (req: Request, res: Response) => { const q = list.parse(req.query); res.json(await listAssetSources(actor(req), type, q.page, q.pageSize, q)); },
  createCategory: async (req: Request, res: Response) => { res.status(201).json(await createCategory(actor(req), categorySchema.parse(req.body))); },
  updateCategory: async (req: Request, res: Response) => { const q = categorySchema.extend({ expectedRevision: z.number().int().positive() }).parse(req.body); const { expectedRevision, ...input } = q; res.json(await updateCategory(actor(req), id(req), expectedRevision, input)); },
  category: async (req: Request, res: Response) => { res.json(await getCategory(actor(req), id(req))); },
  createAsset: async (req: Request, res: Response) => { res.status(201).json(await createAsset(actor(req), assetInputSchema.parse(req.body))); },
  updateAsset: async (req: Request, res: Response) => { const q = assetInputSchema.extend({ expectedRevision: z.number().int().positive() }).parse(req.body); const { expectedRevision, ...input } = q; res.json(await reviseAsset(actor(req), id(req), expectedRevision, input)); },
  asset: async (req: Request, res: Response) => { res.json(await getAsset(actor(req), id(req))); },
  journals: async (req: Request, res: Response) => { res.json(await assetJournals(actor(req), id(req))); },
  change: async (req: Request, res: Response) => { res.status(201).json(await createAssetChange(actor(req), id(req), assetChangeSchema.parse(req.body))); },
  changeDetail: async (req: Request, res: Response) => { res.json(await getChange(actor(req), id(req))); },
  preview: async (req: Request, res: Response) => { res.json(await previewRun(actor(req), runInputSchema.parse(req.body))); },
  createRun: async (req: Request, res: Response) => { res.status(201).json(await createRun(actor(req), runInputSchema.parse(req.body))); },
  run: async (req: Request, res: Response) => { res.json(await getRun(actor(req), id(req))); },
  refreshRun: async (req: Request, res: Response) => { res.json(await refreshRun(actor(req), id(req), sourceSubmitSchema.parse(req.body).expectedRevision)); },
  refreshChange: async (req: Request, res: Response) => { res.json(await refreshAssetChange(actor(req), id(req), sourceSubmitSchema.parse(req.body).expectedRevision)); },
  submit: (type: "ASSET" | "RUN" | "CHANGE") => async (req: Request, res: Response) => { res.status(201).json(await submitAssetSource(actor(req), type, id(req), sourceSubmitSchema.parse(req.body).expectedRevision)); },
  post: async (req: Request, res: Response) => { res.status(201).json(await applyAssetSource(actor(req), id(req), sourcePostSchema.parse(req.body).approvalRequestId)); },
  cancel: (type: "ASSET" | "RUN" | "CHANGE") => async (req: Request, res: Response) => { const q = cancelSourceSchema.parse(req.body); res.json(await cancelAssetSource(actor(req), type, id(req), q.expectedRevision, q.reason)); },
  reconciliation: async (req: Request, res: Response) => { res.json(await assetReconciliation(actor(req))); }
};
