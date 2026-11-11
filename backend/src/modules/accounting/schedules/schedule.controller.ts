import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../../../lib/http.js";
import { approvalListSchema } from "../approval/approval.schema.js";
import { sourcePostSchema, sourceReversalSchema, sourceSubmitSchema, cancelSourceSchema } from "../apar/apar.schema.js";
import { dateOnly } from "../period/period.schema.js";
import { accrualInputSchema, accrualUpdateSchema, accrualAdjustmentSchema, planInputSchema, scheduleInputSchema, scheduleRequestSchema, submitSchedulePeriodSchema } from "./schedule.schema.js";
import { createAccrual, updateAccrual, getAccrual, createAccrualAdjustment, requestAccrualReversal } from "./accrual.service.js";
import { createSchedule, getSchedule, listStage23, previewSchedule } from "./schedule.service.js";
import { applyStage23Source, cancelAccrual, dueReversals, getPeriod, schedulePeriodList, submitAccrual, submitScheduleCommand, submitSchedulePeriod } from "./schedule.workflow.js";
function actor(req: Request) { if (!req.auth?.userId) throw new HttpError(401, "Authentication required"); return req.auth.userId; }
const id = (req: Request) => z.string().uuid().parse(req.params.id);
export const stage23Controller = {
  createAccrual: async (req: Request, res: Response) => { res.status(201).json(await createAccrual(actor(req), accrualInputSchema.parse(req.body))); },
  updateAccrual: async (req: Request, res: Response) => { res.json(await updateAccrual(actor(req), id(req), accrualUpdateSchema.parse(req.body))); },
  getAccrual: async (req: Request, res: Response) => { res.json(await getAccrual(actor(req), id(req))); },
  listAccruals: async (req: Request, res: Response) => { const q = approvalListSchema.parse(req.query); res.json(await listStage23(actor(req), "ACCRUAL", q.page, q.pageSize)); },
  cancelAccrual: async (req: Request, res: Response) => { const q = cancelSourceSchema.parse(req.body); res.json(await cancelAccrual(actor(req), id(req), q.expectedRevision, q.reason)); },
  adjustAccrual: async (req: Request, res: Response) => { res.status(201).json(await createAccrualAdjustment(actor(req), id(req), accrualAdjustmentSchema.parse(req.body))); },
  submitAccrual: async (req: Request, res: Response) => { res.status(201).json(await submitAccrual(actor(req), id(req), sourceSubmitSchema.parse(req.body).expectedRevision)); },
  apply: async (req: Request, res: Response) => { res.status(201).json(await applyStage23Source(actor(req), id(req), sourcePostSchema.parse(req.body).approvalRequestId)); },
  reverseAccrual: async (req: Request, res: Response) => { const q = sourceReversalSchema.parse(req.body); res.status(201).json(await requestAccrualReversal(actor(req), id(req), q.accountingDate, q.remark)); },
  scheduledReversal: async (req: Request, res: Response) => { const q = z.object({ remark: z.string().min(1).max(1000) }).strict().parse(req.body); res.status(201).json(await requestAccrualReversal(actor(req), id(req), undefined, q.remark, true)); },
  dueReversals: async (req: Request, res: Response) => { const q = approvalListSchema.extend({ asOf: dateOnly }).parse(req.query); res.json(await dueReversals(actor(req), q.asOf, q.page, q.pageSize)); },
  preview: async (req: Request, res: Response) => { res.json(await previewSchedule(actor(req), planInputSchema.parse(req.body))); },
  createSchedule: async (req: Request, res: Response) => { res.status(201).json(await createSchedule(actor(req), scheduleInputSchema.parse(req.body))); },
  getSchedule: async (req: Request, res: Response) => { res.json(await getSchedule(actor(req), id(req))); },
  listSchedules: async (req: Request, res: Response) => { const q = approvalListSchema.parse(req.query); res.json(await listStage23(actor(req), "SCHEDULE", q.page, q.pageSize)); },
  command: async (req: Request, res: Response) => { const q = scheduleRequestSchema.parse(req.body); res.status(201).json(await submitScheduleCommand(actor(req), id(req), q.expectedRevision, q.command)); },
  periodList: async (req: Request, res: Response) => { res.json(await schedulePeriodList(actor(req), id(req))); },
  period: async (req: Request, res: Response) => { res.json(await getPeriod(actor(req), id(req))); },
  submitPeriod: async (req: Request, res: Response) => { const q = submitSchedulePeriodSchema.parse(req.body); res.status(201).json(await submitSchedulePeriod(actor(req), id(req), q.expectedRevision, q.recognitionEvidence)); }
};
