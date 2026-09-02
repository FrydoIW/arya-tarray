import { apiFetch } from "@/lib/api";
import type {
  EditIncomeCorrectionChange,
  EditIncomeDetail,
  EditIncomeWorkspace,
  ExecuteEditIncomeResponse
} from "../types";

export function getEditIncomeWorkspace(month: string): Promise<EditIncomeWorkspace> {
  const params = new URLSearchParams({ month });
  return apiFetch<EditIncomeWorkspace>(`/reconciliation/edit-income/workspace?${params.toString()}`);
}

export function getEditIncomeDetail(statementId: string): Promise<EditIncomeDetail> {
  return apiFetch<EditIncomeDetail>(`/reconciliation/edit-income/${encodeURIComponent(statementId)}`);
}

export function executeEditIncomeCorrection(
  statementId: string,
  changes: EditIncomeCorrectionChange[]
): Promise<ExecuteEditIncomeResponse> {
  return apiFetch<ExecuteEditIncomeResponse>(
    `/reconciliation/edit-income/${encodeURIComponent(statementId)}/execute`,
    {
      method: "POST",
      body: JSON.stringify({ changes })
    }
  );
}
