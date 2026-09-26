import { apiFetch } from "@/lib/api";
import type { CampaignMonitoringWorkspace, TimeBasedMonitoringWorkspace, TimeBasedTimelineFilter } from "../types";
export type TimeBasedMonitoringQuery = { timelinePage?: number; timelinePageSize?: number; timelineFilter?: TimeBasedTimelineFilter; windowStart?: string };
export const getTimeBasedMonitoring = (query: TimeBasedMonitoringQuery = {}, signal?: AbortSignal) => {
  const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
  return apiFetch<TimeBasedMonitoringWorkspace>(`/monitoring/time-based/workspace${search.size ? `?${search}` : ""}`, { signal });
};
export const getCampaignMonitoring = (signal?: AbortSignal) => apiFetch<CampaignMonitoringWorkspace>("/monitoring/campaign/workspace", { signal });
