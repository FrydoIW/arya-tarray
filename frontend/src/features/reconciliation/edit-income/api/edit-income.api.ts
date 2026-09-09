import { apiFetch } from "@/lib/api";
import type {
  EditIncomeCorrectionRequest,
  EditIncomeDetail,
  EditIncomePeriodMode,
  EditIncomeWorkspace,
  ExecuteEditIncomeResponse
} from "../types";

export function getEditIncomeWorkspace(period: { mode: EditIncomePeriodMode; month: string; date: string }, signal?: AbortSignal): Promise<EditIncomeWorkspace> {
  const params = new URLSearchParams({ periodMode: period.mode });
  if (period.mode === "DAY") params.set("date", period.date);
  else params.set("month", period.month);
  return apiFetch<EditIncomeWorkspace>(`/reconciliation/edit-income/workspace?${params.toString()}`, { signal });
}

export function getEditIncomeDetail(statementId: string, signal?: AbortSignal): Promise<EditIncomeDetail> {
  return apiFetch<EditIncomeDetail>(`/reconciliation/edit-income/${encodeURIComponent(statementId)}`, { signal });
}

export function executeEditIncomeCorrection(
  statementId: string,
  corrections: EditIncomeCorrectionRequest[]
): Promise<ExecuteEditIncomeResponse> {
  return apiFetch<ExecuteEditIncomeResponse>(
    `/reconciliation/edit-income/${encodeURIComponent(statementId)}/execute`,
    {
      method: "POST",
      body: JSON.stringify({ corrections })
    }
  );
}
