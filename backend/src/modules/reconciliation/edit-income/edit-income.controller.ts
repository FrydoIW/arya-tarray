import type { Request, Response } from "express";
import {
  editIncomeStatementParamsSchema,
  editIncomeWorkspaceQuerySchema,
  executeEditIncomeSchema
} from "./edit-income.schema.js";
import { executeEditIncome, getEditIncomeDetail, getEditIncomeWorkspace } from "./edit-income.service.js";

export async function getEditIncomeWorkspaceController(req: Request, res: Response) {
  const query = editIncomeWorkspaceQuerySchema.parse(req.query);
  res.json(await getEditIncomeWorkspace(query));
}

export async function getEditIncomeDetailController(req: Request, res: Response) {
  const { statementId } = editIncomeStatementParamsSchema.parse(req.params);
  res.json(await getEditIncomeDetail(statementId));
}

export async function executeEditIncomeController(req: Request, res: Response) {
  const { statementId } = editIncomeStatementParamsSchema.parse(req.params);
  const input = executeEditIncomeSchema.parse(req.body ?? {});
  res.json(await executeEditIncome(statementId, input, req.auth!.userId));
}
