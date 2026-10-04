"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarClock, CircleGauge, Flag, WalletCards } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { useAuthSession } from "@/features/auth/context/AuthSessionContext";
import { formatMoney } from "@/lib/format";
import { getWorkspaceCache, readWorkspace, workspaceCacheKey } from "@/lib/workspace-cache";
import { getTimeBasedMonitoring } from "../api/monitoring.api";
import { TIME_BASED_MONITORING_WORKSPACE_PREFIX } from "@/lib/monitoring-cache";
import type { TimeBasedMonitoringWorkspace, TimeBasedTimelineFilter } from "../types";
import { TimeBasedCoverageTimeline } from "./TimeBasedCoverageTimeline";
import { TimeBasedProgramOverview } from "./TimeBasedProgramOverview";
import styles from "./TimeBasedMonitoring.module.css";

const EMPTY_QUERY = { timelinePage: 1, timelinePageSize: 10 };

function useTimeBasedWorkspace(query: { timelinePage: number; timelinePageSize: number; timelineFilter: TimeBasedTimelineFilter; windowStart?: string }) {
  const key = workspaceCacheKey(TIME_BASED_MONITORING_WORKSPACE_PREFIX, query);
  const [data, setData] = useState<TimeBasedMonitoringWorkspace | null>(() => getWorkspaceCache<TimeBasedMonitoringWorkspace>(key)?.value ?? null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const read = readWorkspace(key, signal => getTimeBasedMonitoring(query, signal));
    if (read.cached) setData(read.cached);
    (read.promise ?? Promise.resolve(read.cached!)).then(value => { if (!controller.signal.aborted) { setData(value); setError(""); } })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Unable to load monitoring data."); })
      .finally(read.release);
    return () => controller.abort();
  }, [key, query]);
  return { data, error };
}

export function TimeBasedMonitoringScreen() {
  const auth = useAuthSession();
  const [timelinePage, setTimelinePage] = useState(1);
  const [timelineFilter, setTimelineFilter] = useState<TimeBasedTimelineFilter>("ALL");
  const [windowStart, setWindowStart] = useState<string | undefined>();
  const query = useMemo(() => ({ ...EMPTY_QUERY, timelinePage, timelineFilter, ...(windowStart ? { windowStart } : {}) }), [timelinePage, timelineFilter, windowStart]);
  const { data, error } = useTimeBasedWorkspace(query);
  const changeFilter = useCallback((next: TimeBasedTimelineFilter) => { setTimelineFilter(next); setTimelinePage(1); }, []);
  const changeWindow = useCallback((next: string) => { setWindowStart(next); setTimelinePage(1); }, []);

  const metrics: Array<[string, string | number, string, ReactNode, "blue" | "green" | "gold" | "violet"]> = data ? [
    ["Active Programs", data.summary.activePrograms, "Active donor programs", <CircleGauge size={20} key="active" />, "blue"],
    ["Currently Covered", data.summary.currentlyCovered, "Current coverage", <CalendarClock size={20} key="covered" />, "green"],
    ["Expiring ≤30 Days", data.summary.expiringSoon, "Current coverage", <Flag size={20} key="expiring" />, "gold"],
    ["Outstanding Carry", formatMoney(data.summary.outstandingCarry), `${data.summary.carrySourceCount} carry sources`, <WalletCards size={20} key="carry" />, "violet"]
  ] : [];

  return <main className={styles.page}>
    <header className={styles.pageHead}>
      <div className={styles.titleBlock}><span className={styles.eyebrow}>MONITORING / TIME BASED</span><h1>Time Based Monitoring</h1><p>Current programs, recorded coverage, and TIME_BASED carry. This screen is read-only.</p></div>
    </header>
    {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}
    {data ? <>
      <section className={styles.metrics} aria-label="Time Based summary">{metrics.map(([label, value, detail, icon, tone]) => <MetricCard key={label} label={label} value={String(value)} detail={detail} icon={icon} tone={tone} />)}</section>
      <TimeBasedProgramOverview rows={data.eventGroups} />
      <TimeBasedCoverageTimeline timeline={data.timeline} filter={timelineFilter} onFilterChange={changeFilter} onWindowChange={changeWindow} onPageChange={setTimelinePage} canViewMemberData={auth.menuCodes.includes("MEMBER_DATA")} today={data.today} />
    </> : !error ? <section className={styles.loadingPanel} role="status"><CalendarClock size={20} /><span>Loading Time Based Monitoring…</span></section> : null}
  </main>;
}
