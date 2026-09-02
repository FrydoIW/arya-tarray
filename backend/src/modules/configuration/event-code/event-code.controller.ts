import type { Request, Response } from "express";
import { eventCodeExecuteSchema, eventCodeListSchema } from "./event-code.schema.js";
import { executeEventCodeChanges, listEventCodes } from "./event-code.service.js";

export async function listEventCodesController(req: Request, res: Response) {
  const query = eventCodeListSchema.parse(req.query);
  res.json(await listEventCodes(query.search));
}

export async function executeEventCodeChangesController(req: Request, res: Response) {
  const input = eventCodeExecuteSchema.parse(req.body);
  res.json(await executeEventCodeChanges(input, req.auth!.userId));
}
