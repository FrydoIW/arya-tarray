import { apiFetch } from "@/lib/api";
import type { DashboardSummary } from "../types";

export function getDashboardSummary(month: string) {
  const query = new URLSearchParams({ month });
  return apiFetch<DashboardSummary>(`/monitoring/dashboard/workspace?${query.toString()}`);
}
