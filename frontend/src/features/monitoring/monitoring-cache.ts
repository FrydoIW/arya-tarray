import { invalidateWorkspaceCache } from "@/lib/workspace-cache";

export const TIME_BASED_MONITORING_WORKSPACE_PREFIX = "monitoring/time-based/workspace";
export const CAMPAIGN_MONITORING_WORKSPACE_PREFIX = "monitoring/campaign/workspace";

/** Invalidate only the read models whose financial evidence may have changed. */
export function invalidateMonitoringWorkspaces(targets: Array<"timeBased" | "campaign">) {
  for (const target of new Set(targets)) {
    invalidateWorkspaceCache(target === "timeBased"
      ? TIME_BASED_MONITORING_WORKSPACE_PREFIX
      : CAMPAIGN_MONITORING_WORKSPACE_PREFIX);
  }
}
