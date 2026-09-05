import { apiFetch } from "@/lib/api";
import type { DashboardPeriodMode, DashboardSummary } from "../types";

export function getDashboardSummary(period: { mode: DashboardPeriodMode; month: string; date: string }, signal?: AbortSignal) {
  const query = new URLSearchParams({ periodMode: period.mode });
  if (period.mode === "MONTH") query.set("month", period.month);
  else query.set("date", period.date);
  return apiFetch<DashboardSummary>(`/monitoring/dashboard/workspace?${query.toString()}`, { signal });
}
