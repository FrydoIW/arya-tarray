import type { Request, Response } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { HttpError } from "../../../lib/http.js";
import { csvText, csvDecimal, serializeCsv } from "../../../lib/csv.js";
import { reportQuerySchema, policySchema, closeInputSchema, bankReconInputSchema, matchInputSchema, pageSchema } from "./finalization.schema.js";
import { financialStatements } from "./reporting.service.js";
import { createReportingPolicy, submitFinalSource, requestClosing, requestReportSnapshot, getReportSnapshot, finalSourceDetail, applyFinalSource, financialIntegrity, supportingSchedules, openingPreparation } from "./finalization.workflow.js";
import { createBankReconciliation, getBankReconciliation, matchBank, voidBankMatch, bankAdjustmentDraft, listBankReconciliations } from "./bank-reconciliation.service.js";
import { previewClose } from "./closing.service.js";
import { subledgerReconciliations } from "./reconciliation.service.js";
import { submitApproval } from "../approval/approval.service.js";
import { dateOnly } from "../period/period.schema.js";
function actor(req: Request) { if (!req.auth?.userId) throw new HttpError(401, "Authentication required."); return req.auth.userId; }
const id = (req: Request) => z.string().uuid().parse(req.params.id), revision = z.object({ expectedRevision: z.number().int().positive() }).strict();
export const finalizationController = {
  policy: async (req: Request, res: Response) => { const q = z.object({ fiscalYearId: z.string().uuid(), policy: policySchema }).strict().parse(req.body); res.status(201).json(await createReportingPolicy(actor(req), q.fiscalYearId, q.policy)); },
  source: async (req: Request, res: Response) => { res.json(await finalSourceDetail(actor(req), id(req))); },
  submit: async (req: Request, res: Response) => { res.status(201).json(await submitFinalSource(actor(req), id(req), revision.parse(req.body).expectedRevision)); },
  apply: async (req: Request, res: Response) => { const q = z.object({ approvalRequestId: z.string().uuid() }).strict().parse(req.body); res.status(201).json(await applyFinalSource(actor(req), id(req), q.approvalRequestId)); },
  report: async (req: Request, res: Response) => { res.json(await financialStatements(actor(req), reportQuerySchema.parse(req.query))); },
  statement: (type: "financialPosition" | "comprehensiveIncome" | "changesInNetAssets" | "cashFlows" | "trialBalance") => async (req: Request, res: Response) => { const report = await financialStatements(actor(req), reportQuerySchema.parse(req.query)); res.json({ scope: report.scope, status: report.status, official: false, policyId: report.policyId, exceptions: report.exceptions, statement: report[type], comparative: report.comparative }); },
  snapshot: async (req: Request, res: Response) => { res.status(201).json(await requestReportSnapshot(actor(req), reportQuerySchema.parse(req.body))); },
  snapshotDetail: async (req: Request, res: Response) => { res.json(await getReportSnapshot(actor(req), id(req))); },
  integrity: async (req: Request, res: Response) => { res.json(await financialIntegrity(actor(req), reportQuerySchema.parse(req.query))); },
  notes: async (req: Request, res: Response) => { res.json(await supportingSchedules(actor(req), reportQuerySchema.parse(req.query))); },
  opening: async (req: Request, res: Response) => { res.json(await openingPreparation(actor(req), id(req))); },
  reconcile: async (req: Request, res: Response) => { const q = z.object({ fiscalYearId: z.string().uuid(), asOf: dateOnly }).strict().parse(req.query); res.json(await subledgerReconciliations(actor(req), q.fiscalYearId, q.asOf)); },
  closePreview: (type: "PERIOD" | "YEAR") => async (req: Request, res: Response) => { res.json(await previewClose(actor(req), type, id(req))); },
  closeRequest: (type: "PERIOD" | "YEAR", reopen: boolean) => async (req: Request, res: Response) => { const q = closeInputSchema.parse(req.body); res.status(201).json(await requestClosing(actor(req), type, id(req), reopen, q.reason, q.evidenceReference)); },
  bankCreate: async (req: Request, res: Response) => { res.status(201).json(await createBankReconciliation(actor(req), bankReconInputSchema.parse(req.body))); },
  bankAdjustment: async (req: Request, res: Response) => { const q = z.object({ bankTransactionId: z.string().uuid(), kind: z.enum(["CHARGE", "INTEREST"]), offsetAccountId: z.string().uuid(), evidence: z.string().trim().min(10).max(1000) }).strict().parse(req.body); res.status(201).json(await bankAdjustmentDraft(actor(req), id(req), q)); },
  bankGet: async (req: Request, res: Response) => { res.json(await getBankReconciliation(actor(req), id(req))); },
  bankList: async (req: Request, res: Response) => { res.json(await listBankReconciliations(actor(req), pageSchema.parse(req.query))); },
  bankMatch: async (req: Request, res: Response) => { res.status(201).json(await matchBank(actor(req), id(req), matchInputSchema.parse(req.body))); },
  bankVoid: async (req: Request, res: Response) => { const q = z.object({ matchId: z.string().uuid(), reason: z.string().trim().min(10).max(1000) }).strict().parse(req.body); res.json(await voidBankMatch(actor(req), id(req), q.matchId, q.reason)); },
  bankSubmit: async (req: Request, res: Response) => { res.status(201).json(await submitApproval(actor(req), { kind: "BANK_RECONCILIATION", sourceDocumentId: id(req), expectedRevision: revision.parse(req.body).expectedRevision })); },
  bankReopen: async (req: Request, res: Response) => { const q = closeInputSchema.extend({ expectedRevision: z.number().int().positive() }).parse(req.body); res.status(201).json(await submitApproval(actor(req), { kind: "BANK_RECONCILIATION", bankAction: "REOPEN", sourceDocumentId: id(req), expectedRevision: q.expectedRevision, reason: q.reason, evidenceReference: q.evidenceReference })); },
  export: async (req: Request, res: Response) => {
    const { format: raw, ...query } = req.query, format = z.enum(["xlsx", "csv"]).default("xlsx").parse(raw), report = await financialStatements(actor(req), reportQuerySchema.parse(query));
    const rows = [[csvText("DRAFT — internal review required"), csvText(report.status)], [csvText("Policy"), csvText(report.policyReference ?? "PENDING_POLICY")], ...report.exceptions.map(e => [csvText("EXCEPTION"), csvText(e)]),
      [csvText("Assets"), csvDecimal(report.financialPosition.assets)], [csvText("Liabilities"), csvDecimal(report.financialPosition.liabilities)], [csvText("Net assets"), csvDecimal(report.financialPosition.totalNetAssets)], [csvText("Surplus/deficit"), csvDecimal(report.comprehensiveIncome.surplusDeficit)],
      ...report.trialBalance.rows.map(r => [csvText(`${r.code} ${r.name} closing debit-minus-credit`), csvDecimal(r.signedClosingDebit)])];
    res.setHeader("Content-Disposition", `attachment; filename="AryaTarray-financial-DRAFT-${report.scope.to}.${format}"`);
    if (format === "csv") { res.type("text/csv; charset=utf-8").send("\uFEFF" + serializeCsv(rows)); return; }
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("DRAFT financial statements"); for (const row of rows) sheet.addRow(row.map(cell => cell.value));
    sheet.getColumn(1).width = 65; sheet.getColumn(2).width = 50; res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(Buffer.from(await workbook.xlsx.writeBuffer()));
  }
};
