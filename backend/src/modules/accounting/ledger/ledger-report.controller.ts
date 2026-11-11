import type { Request, Response } from "express";
import { ledgerReportQuerySchema } from "./ledger-report.schema.js";
import { getGeneralLedger, getTrialBalance } from "./ledger-report.service.js";

export async function generalLedgerController(req: Request, res: Response) {
  res.json(await getGeneralLedger(ledgerReportQuerySchema.parse(req.query)));
}

export async function trialBalanceController(req: Request, res: Response) {
  res.json(await getTrialBalance(ledgerReportQuerySchema.parse(req.query)));
}
