import type { Request, Response } from "express";
import {
  statementParamsSchema,
  transactionParamsSchema,
  updateFinalEventSchema,
  uploadStatementBodySchema,
  withdrawStatementSchema,
  workspaceQuerySchema
} from "./statement-upload.schema.js";
import {
  executeStatement,
  getStatementUploadWorkspace,
  updateFinalEvent,
  uploadStatement,
  withdrawStatement
} from "./statement-upload.service.js";

export async function getStatementUploadWorkspaceController(req: Request, res: Response) {
  const { statementId } = workspaceQuerySchema.parse(req.query);
  res.json(await getStatementUploadWorkspace(statementId));
}

export async function uploadStatementController(req: Request, res: Response) {
  const { bankAccountId } = uploadStatementBodySchema.parse(req.body);
  const result = await uploadStatement({
    file: req.file,
    bankAccountId,
    userId: req.auth!.userId
  });
  res.status(result.uploadResult.importedTransactions > 0 ? 201 : 200).json(result);
}

export async function updateFinalEventController(req: Request, res: Response) {
  const { statementId, transactionId } = transactionParamsSchema.parse(req.params);
  const input = updateFinalEventSchema.parse(req.body ?? {});
  res.json(await updateFinalEvent(statementId, transactionId, input, req.auth!.userId));
}

export async function executeStatementController(req: Request, res: Response) {
  const { statementId } = statementParamsSchema.parse(req.params);
  res.json(await executeStatement(statementId, req.auth!.userId));
}

export async function withdrawStatementController(req: Request, res: Response) {
  const { statementId } = statementParamsSchema.parse(req.params);
  const input = withdrawStatementSchema.parse(req.body ?? {});
  res.json(await withdrawStatement(statementId, input, req.auth!.userId));
}
