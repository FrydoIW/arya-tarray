import type { Request, Response } from "express";
import { HttpError, SanitizedInternalError } from "../../../lib/http.js";
import {
  duplicateParamsSchema,
  resolveDuplicateSchema,
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
  resolveDuplicate,
  updateFinalEvent,
  uploadStatement,
  withdrawStatement
} from "./statement-upload.service.js";

async function withStatementDiagnostic<T>(operation: string, message: string, work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new SanitizedInternalError(message, `statement-upload.${operation}`, error);
  }
}

export async function getStatementUploadWorkspaceController(req: Request, res: Response) {
  const { statementId } = workspaceQuerySchema.parse(req.query);
  res.json(await withStatementDiagnostic("workspace", "Unable to load the Statement Upload workspace. Use Reload to try again.",
    () => getStatementUploadWorkspace(statementId)));
}

export async function uploadStatementController(req: Request, res: Response) {
  const { bankAccountId } = uploadStatementBodySchema.parse(req.body);
  const result = await withStatementDiagnostic("upload", "Unable to confirm the upload. Use Reload to check the draft list before trying again.",
    () => uploadStatement({ file: req.file, bankAccountId, userId: req.auth!.userId }));
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

export async function resolveDuplicateController(req: Request, res: Response) {
  const { statementId, duplicateId } = duplicateParamsSchema.parse(req.params);
  const input = resolveDuplicateSchema.parse(req.body ?? {});
  res.json(await resolveDuplicate(statementId, duplicateId, input, req.auth!.userId));
}
