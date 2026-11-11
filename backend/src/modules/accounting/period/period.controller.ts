import type { Request, Response } from "express";
import { fiscalYearSchema, periodSchema } from "./period.schema.js";
import { createFiscalYear, createPeriod, listFiscalYears } from "./period.service.js";

export async function listFiscalYearsController(_req: Request, res: Response) {
  res.json(await listFiscalYears());
}

export async function createFiscalYearController(req: Request, res: Response) {
  res.status(201).json(await createFiscalYear(fiscalYearSchema.parse(req.body)));
}

export async function createPeriodController(req: Request, res: Response) {
  res.status(201).json(await createPeriod(periodSchema.parse(req.body)));
}
