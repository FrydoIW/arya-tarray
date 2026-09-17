import { apiFetch } from "@/lib/api";
import type {
  StatementUploadResponse,
  StatementUploadWorkspace,
  UpdateFinalEventInput,
  UpdateFinalEventResponse,
  UploadStatementInput,
  WithdrawStatementResponse
} from "../types";

export function getStatementUploadWorkspace(statementId?: string, signal?: AbortSignal): Promise<StatementUploadWorkspace> {
  const query = statementId ? `?statementId=${encodeURIComponent(statementId)}` : "";
  return apiFetch<StatementUploadWorkspace>(`/reconciliation/statement-upload/workspace${query}`, { signal });
}

export function uploadStatement(input: UploadStatementInput): Promise<StatementUploadResponse> {
  const body = new FormData();
  body.append("file", input.file);
  body.append("bankAccountId", input.bankAccountId);
  return apiFetch<StatementUploadResponse>("/reconciliation/statement-upload/upload", {
    method: "POST",
    body
  });
}

export function updateDraftTransactionFinalEvent(
  input: UpdateFinalEventInput
): Promise<UpdateFinalEventResponse> {
  const body: { eventCodeId: string | null; eventCampaignId: string | null; remark?: string | null } = {
    eventCodeId: input.eventCodeId,
    eventCampaignId: input.eventCampaignId
  };
  if (input.remark !== undefined) body.remark = input.remark;
  return apiFetch<UpdateFinalEventResponse>(
    `/reconciliation/statement-upload/${encodeURIComponent(input.statementId)}/transactions/${encodeURIComponent(input.transactionId)}/final-event`,
    {
      method: "PATCH",
      body: JSON.stringify(body)
    }
  );
}

export function executeStatementDraft(statementId: string): Promise<StatementUploadWorkspace> {
  return apiFetch<StatementUploadWorkspace>(
    `/reconciliation/statement-upload/${encodeURIComponent(statementId)}/execute`,
    { method: "POST" }
  );
}

export function withdrawStatementDraft(input: { statementId: string; reason: string }): Promise<WithdrawStatementResponse> {
  return apiFetch<WithdrawStatementResponse>(
    `/reconciliation/statement-upload/${encodeURIComponent(input.statementId)}/withdraw`,
    { method: "POST", body: JSON.stringify({ reason: input.reason }) }
  );
}
