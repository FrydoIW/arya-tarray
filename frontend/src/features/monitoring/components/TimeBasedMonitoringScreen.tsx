"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarClock, CircleGauge, Coins, Flag, WalletCards } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { useAuthSession } from "@/features/auth/context/AuthSessionContext";
import { formatDateTime, formatMoney } from "@/lib/format";
import { getWorkspaceCache, readWorkspace, workspaceCacheKey } from "@/lib/workspace-cache";
import { getTimeBasedMonitoring } from "../api/monitoring.api";
import { TIME_BASED_MONITORING_WORKSPACE_PREFIX } from "../monitoring-cache";
import type { TimeBasedMonitoringWorkspace, TimeBasedTimelineFilter } from "../types";
import { TimeBasedCoverageTimeline } from "./TimeBasedCoverageTimeline";
import { TimeBasedProgramOverview } from "./TimeBasedProgramOverview";
import styles from "../styles/monitoring.module.css";

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
  const metrics: Array<[string, string | number, ReactNode]> = [
    ["Active Programs", data?.summary.activePrograms ?? 0, <CircleGauge size={18} key="active" />],
    ["Currently Covered", data?.summary.currentlyCovered ?? 0, <CalendarClock size={18} key="covered" />],
    ["Expiring ≤30 Days", data?.summary.expiringSoon ?? 0, <Flag size={18} key="expiring" />],
    ["Outstanding Carry", formatMoney(data?.summary.outstandingCarry ?? "0"), <WalletCards size={18} key="carry" />],
    ["Carry Sources", data?.summary.carrySourceCount ?? 0, <Coins size={18} key="sources" />]
  ];
  return <main className={`${styles.page} ${styles.timeBasedPage}`}>
    <header className={styles.pageHead}><div><span>MONITORING</span><h1>Time Based Monitoring</h1><p>Current programs, recorded coverage, and TIME_BASED carry. This screen is read-only.</p></div>{data ? <aside><CalendarClock size={17} /><span>Last updated<time>{formatDateTime(data.generatedAt)}</time></span></aside> : null}</header>
    {error ? <div className="ui-alert ui-alert-error">{error}</div> : null}
    <section className={styles.metrics}>{metrics.map(([label, value, icon]) => <MetricCard key={label} label={label} value={String(value)} detail="Current state" icon={icon} tone="blue" />)}</section>
    <TimeBasedProgramOverview rows={data?.eventGroups ?? []} />
    {data ? <TimeBasedCoverageTimeline timeline={data.timeline} filter={timelineFilter} onFilterChange={changeFilter} onWindowChange={changeWindow} onPageChange={setTimelinePage} canViewMemberData={auth.menuCodes.includes("MEMBER_DATA")} today={data.today} /> : <section className={`${styles.panel} ${styles.timelineLoading}`}><span>Loading coverage timeline…</span></section>}
  </main>;
}
