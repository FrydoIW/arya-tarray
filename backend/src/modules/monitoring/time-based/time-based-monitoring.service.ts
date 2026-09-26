import { currentBusinessDayValue } from "../../../lib/business-time.js";
import type { TimeBasedMonitoringQuery } from "./time-based-monitoring.schema.js";
import { loadTimeBasedMonitoring } from "./time-based-monitoring.repository.js";
import { timelineWindow } from "./time-based-monitoring.domain.js";

export async function getTimeBasedMonitoringWorkspace(query: TimeBasedMonitoringQuery) {
  const today = new Date(`${currentBusinessDayValue()}T00:00:00.000Z`);
  const expiringUntil = new Date(today); expiringUntil.setUTCDate(expiringUntil.getUTCDate() + 30);
  return { ...await loadTimeBasedMonitoring(today, expiringUntil, { ...query, window: timelineWindow(today, query.windowStart) }), today: currentBusinessDayValue(), generatedAt: new Date() };
}
