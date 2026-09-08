import { apiFetch } from "@/lib/api";
import type {
  StatementUploadWorkspace,
  UpdateFinalEventInput,
  UpdateFinalEventResponse,
  UploadStatementInput
} from "../types";

export function getStatementUploadWorkspace(statementId?: string, signal?: AbortSignal): Promise<StatementUploadWorkspace> {
  const query = statementId ? `?statementId=${encodeURIComponent(statementId)}` : "";
  return apiFetch<StatementUploadWorkspace>(`/reconciliation/statement-upload/workspace${query}`, { signal });
}

export function uploadStatement(input: UploadStatementInput): Promise<StatementUploadWorkspace> {
  const body = new FormData();
  body.append("file", input.file);
  body.append("bankAccountId", input.bankAccountId);
  return apiFetch<StatementUploadWorkspace>("/reconciliation/statement-upload/upload", {
    method: "POST",
    body
  });
}

export function updateDraftTransactionFinalEvent(
  input: UpdateFinalEventInput
): Promise<UpdateFinalEventResponse> {
  return apiFetch<UpdateFinalEventResponse>(
    `/reconciliation/statement-upload/${encodeURIComponent(input.statementId)}/transactions/${encodeURIComponent(input.transactionId)}/final-event`,
    {
      method: "PATCH",
      body: JSON.stringify({ eventCodeId: input.eventCodeId })
    }
  );
}

export function executeStatementDraft(statementId: string): Promise<StatementUploadWorkspace> {
  return apiFetch<StatementUploadWorkspace>(
    `/reconciliation/statement-upload/${encodeURIComponent(statementId)}/execute`,
    { method: "POST" }
  );
}
