import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../../../lib/http.js";
import { approvalDecisionSchema, approvalListSchema, approvalRequestSchema, approvalSettingsSchema, cancellationSchema,
  draftInputSchema, updateDraftSchema } from "./approval.schema.js";
import { cancelApproval, createDraft, decideApproval, getApproval, getDraft, listApprovals,
  listDrafts, applyApprovedAction, submitApproval, updateDraft, getApprovalSettings, updateApprovalSettings } from "./approval.service.js";

function actor(req: Request) {
  if (!req.auth?.userId) throw new HttpError(401, "Authentication required");
  return req.auth.userId;
}
const id = (req: Request) => z.string().uuid().parse(req.params.id);
export async function createDraftController(req: Request, res: Response) {
  res.status(201).json(await createDraft(actor(req), draftInputSchema.parse(req.body)));
}
export async function updateDraftController(req: Request, res: Response) {
  res.json(await updateDraft(actor(req), id(req), updateDraftSchema.parse(req.body)));
}
export async function getDraftController(req: Request, res: Response) {
  res.json(await getDraft(actor(req), id(req)));
}
export async function listDraftsController(req: Request, res: Response) {
  const query = approvalListSchema.parse(req.query);
  res.json(await listDrafts(actor(req), query.page, query.pageSize));
}
export async function submitApprovalController(req: Request, res: Response) {
  res.status(201).json(await submitApproval(actor(req), approvalRequestSchema.parse(req.body)));
}
export async function decideApprovalController(req: Request, res: Response) {
  const input = approvalDecisionSchema.parse(req.body);
  res.json(await decideApproval(actor(req), id(req), input.decision, input.remark));
}
export async function cancelApprovalController(req: Request, res: Response) {
  res.json(await cancelApproval(actor(req), id(req), cancellationSchema.parse(req.body).remark));
}
export async function postApprovalController(req: Request, res: Response) {
  res.status(201).json(await applyApprovedAction(actor(req), id(req)));
}
export async function listApprovalsController(req: Request, res: Response) {
  res.json(await listApprovals(actor(req), approvalListSchema.parse(req.query)));
}
export async function getApprovalController(req: Request, res: Response) {
  res.json(await getApproval(actor(req), id(req)));
}
export async function getApprovalSettingsController(req: Request, res: Response) {
  res.json(await getApprovalSettings(actor(req)));
}
export async function updateApprovalSettingsController(req: Request, res: Response) {
  res.json(await updateApprovalSettings(actor(req), approvalSettingsSchema.parse(req.body)));
}
