import type { Request, Response } from "express";
import {
  statementParamsSchema,
  transactionParamsSchema,
  updateFinalEventSchema,
  uploadStatementBodySchema,
  workspaceQuerySchema
} from "./statement-upload.schema.js";
import {
  executeStatement,
  getStatementUploadWorkspace,
  updateFinalEvent,
  uploadStatement
} from "./statement-upload.service.js";

export async function getStatementUploadWorkspaceController(req: Request, res: Response) {
  const { statementId } = workspaceQuerySchema.parse(req.query);
  res.json(await getStatementUploadWorkspace(statementId));
}

export async function uploadStatementController(req: Request, res: Response) {
  const { bankAccountId } = uploadStatementBodySchema.parse(req.body);
  res.status(201).json(await uploadStatement({
    file: req.file,
    bankAccountId,
    userId: req.auth!.userId
  }));
}

export async function updateFinalEventController(req: Request, res: Response) {
  const { transactionId } = transactionParamsSchema.parse(req.params);
  const input = updateFinalEventSchema.parse(req.body ?? {});
  res.json(await updateFinalEvent(transactionId, input, req.auth!.userId));
}

export async function executeStatementController(req: Request, res: Response) {
  const { statementId } = statementParamsSchema.parse(req.params);
  res.json(await executeStatement(statementId, req.auth!.userId));
}
