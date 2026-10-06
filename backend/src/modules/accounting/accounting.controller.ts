import type { Request, Response } from "express";
import { z } from "zod";
import { accountingQuerySchema } from "./accounting.schema.js";
import { getAccountingJournal, getAccountingReport, getAccountingOptions } from "./accounting.service.js";
import { exportAccountingReport } from "./accounting.report.js";

export async function accountingReportController(req: Request, res: Response) {
  res.json(await getAccountingReport(accountingQuerySchema.parse(req.query)));
}
export async function accountingOptionsController(req: Request, res: Response) {
  res.json(await getAccountingOptions(z.string().max(100).default("").parse(req.query.memberSearch)));
}
export async function accountingJournalController(req: Request, res: Response) {
  res.json(await getAccountingJournal(z.string().uuid().parse(req.params.journalId)));
}
export async function accountingExportController(req: Request, res: Response) {
  const report = await exportAccountingReport(accountingQuerySchema.parse(req.query), req.auth!.userId);
  res.setHeader("Content-Type", report.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${report.fileName}"`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  res.send(report.buffer);
}
