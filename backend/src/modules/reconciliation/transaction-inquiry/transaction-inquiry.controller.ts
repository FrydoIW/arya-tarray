import type { Request, Response } from "express";
import {
  transactionInquiryParamsSchema,
  transactionInquiryReportQuerySchema,
  transactionInquiryWorkspaceQuerySchema
} from "./transaction-inquiry.schema.js";
import {
  generateTransactionInquiryReport,
  getTransactionInquiryDetail,
  getTransactionInquiryWorkspace
} from "./transaction-inquiry.service.js";

export async function getTransactionInquiryWorkspaceController(req: Request, res: Response) {
  const query = transactionInquiryWorkspaceQuerySchema.parse(req.query);
  res.json(await getTransactionInquiryWorkspace(query));
}

export async function getTransactionInquiryDetailController(req: Request, res: Response) {
  const { transactionId } = transactionInquiryParamsSchema.parse(req.params);
  res.json(await getTransactionInquiryDetail(transactionId));
}

export async function getTransactionInquiryReportController(req: Request, res: Response) {
  const query = transactionInquiryReportQuerySchema.parse(req.query);
  const report = await generateTransactionInquiryReport(query, req.auth!.userId);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${report.fileName}"`);
  res.setHeader("Content-Length", String(report.buffer.length));
  res.send(report.buffer);
}
