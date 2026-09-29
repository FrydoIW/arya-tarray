import Link from "next/link";
import type { CSSProperties } from "react";
import { ChevronLeft, ChevronRight, CircleAlert, CalendarDays } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { TimeBasedMonitoringWorkspace, TimeBasedTimelineFilter } from "../types";
import { monthLabels, shiftWindowStart, timelineDateLabel, timelineSegmentGeometry, todayMarkerPosition } from "./time-based-timeline.utils";
import timelineStyles from "./TimeBasedCoverageTimeline.module.css";
import styles from "./TimeBasedMonitoring.module.css";

const FILTERS: Array<{ value: TimeBasedTimelineFilter; label: string }> = [
  { value: "ALL", label: "All" }, { value: "EXPIRING", label: "Expiring ≤30 Days" },
  { value: "NO_COVERAGE", label: "No Coverage" }, { value: "EXPIRED", label: "Expired" }
];

function sourceLabel(source: string) {
  if (source === "TRANSACTION") return "Transaction";
  if (source === "TRANSFER") return "Transfer";
  if (source === "OPENING") return "Opening";
  return source;
}

function coverageStatus(row: TimeBasedMonitoringWorkspace["timeline"]["rows"][number]) {
  if (row.coverageStatus === "INACTIVE") return { label: "Inactive", tone: "muted" };
  if (row.coverageStatus === "COVERED") return { label: "Covered", tone: "positive" };
  if (row.coverageStatus === "EXPIRED") return { label: "Expired", tone: "warning" };
  return { label: "No Coverage", tone: "neutral" };
}

export function TimeBasedCoverageTimeline({
  timeline, filter, onFilterChange, onWindowChange, onPageChange, canViewMemberData, today
}: {
  timeline: TimeBasedMonitoringWorkspace["timeline"];
  filter: TimeBasedTimelineFilter;
  onFilterChange: (filter: TimeBasedTimelineFilter) => void;
  onWindowChange: (start: string) => void;
  onPageChange: (page: number) => void;
  canViewMemberData: boolean;
  today: string;
}) {
  const labels = monthLabels(timeline.window);
  const marker = todayMarkerPosition(today, timeline.window);
  const { pagination } = timeline;
  const gridStyle = {
    "--timeline-months": timeline.window.monthCount,
    "--timeline-width": `${Math.max(720, timeline.window.monthCount * 132)}px`,
    width: `${Math.max(720, timeline.window.monthCount * 132)}px`
  } as CSSProperties;
  return <section className={`${styles.panel} ${styles.timelinePanel}`} aria-labelledby="coverage-timeline-title">
    <div className={`${styles.sectionHeading} ${styles.timelineHeading}`}>
      <div><h2 id="coverage-timeline-title">Coverage Timeline</h2><p>Recorded coverage periods for each donor program. Financial balances are intentionally shown elsewhere.</p></div>
      <div className={styles.windowControls}><button type="button" aria-label="Previous period" onClick={() => onWindowChange(shiftWindowStart(timeline.window.start, -6))}><ChevronLeft size={15} /></button><strong>{timelineDateLabel(timeline.window.start)} – {timelineDateLabel(timeline.window.end)}</strong><button type="button" aria-label="Next period" onClick={() => onWindowChange(shiftWindowStart(timeline.window.start, 6))}><ChevronRight size={15} /></button></div>
    </div>
    <div className={styles.toolbar}>
      <div className={styles.filterRow} role="group" aria-label="Timeline filter">{FILTERS.map(item => <button type="button" key={item.value} aria-pressed={filter === item.value} data-active={filter === item.value} onClick={() => onFilterChange(item.value)}>{item.label}</button>)}</div>
      <div className={styles.sourceLegend} aria-label="Coverage sources"><span data-source="TRANSACTION"><i /> Transaction</span><span data-source="TRANSFER"><i /> Transfer</span><span data-source="OPENING"><i /> Opening</span></div>
    </div>
    <div className={timelineStyles.timelineViewport}>
      <div className={timelineStyles.identityPane}>
        <div className={timelineStyles.identityHeader}><span>Donor</span><span>Program / Event</span></div>
        <div className={timelineStyles.identityRuler} aria-hidden="true" />
        {timeline.rows.map(row => <div className={timelineStyles.identityRow} key={row.subscriptionId}>
          <div className={styles.memberCell}>{canViewMemberData ? <Link href={`/member/data/${row.member.id}`}>{row.member.memberName}</Link> : <strong>{row.member.memberName}</strong>}</div>
          <div className={styles.programCell}><strong>{row.program.code} · {row.program.eventName}</strong>{!row.activeFlag ? <em>INACTIVE</em> : null}</div>
        </div>)}
      </div>
      <div className={timelineStyles.canvasScroll}>
        <div className={timelineStyles.canvas} style={gridStyle}>
          <div className={styles.monthHeader}>{labels.map(label => <span key={label}>{label}</span>)}</div>
          <div className={timelineStyles.todayRuler} aria-label={marker !== null ? `Today, ${timelineDateLabel(today)}` : undefined}>
            {marker !== null ? <i className={timelineStyles.todayMarker} style={{ left: `${marker}%` }}><b>Today</b></i> : null}
          </div>
          <div className={timelineStyles.timelineBody}>
            {marker !== null ? <i className={timelineStyles.todayLine} style={{ left: `${marker}%` }} aria-hidden="true" /> : null}
            {timeline.rows.map(row => <div className={`${styles.timelineLane} ${timelineStyles.timelineLane}`} key={row.subscriptionId}>{row.coverageSegments.map(segment => { const geometry = timelineSegmentGeometry(segment, timeline.window); return geometry ? <span className={styles.coverageBar} data-source={segment.source} key={segment.coverageId} style={{ left: `${geometry.left}%`, width: `${geometry.width}%` }} title={`Coverage source: ${sourceLabel(segment.source)} · ${timelineDateLabel(segment.coverageFrom)} – ${timelineDateLabel(segment.coverageTo)}`}><b>{sourceLabel(segment.source)}</b></span> : null; })}{!row.coverageSegments.length ? <span className={styles.noCoverage}><CircleAlert size={14} /> No coverage in this window</span> : null}</div>)}
          </div>
        </div>
      </div>
    </div>
    {!timeline.rows.length ? <div className={`${styles.empty} ${styles.timelineEmpty}`}><CalendarDays size={18} /> No programs match this filter.</div> : null}
    {timeline.rows.length ? <div className={timelineStyles.summary} aria-label="Coverage summary">
      <div className={timelineStyles.summaryTitle}><strong>Carry &amp; coverage status</strong><span>For the programs shown on this page</span></div>
      <div className={timelineStyles.summaryHeader}><span>Donor</span><span>Program / Event</span><span>Carry</span><span>Status</span></div>
      {timeline.rows.map(row => { const status = coverageStatus(row); return <div className={timelineStyles.summaryRow} key={row.subscriptionId}><strong>{row.member.memberName}</strong><span>{row.program.code} · {row.program.eventName}</span><strong className={timelineStyles.carry}>{formatMoney(row.carryBalance)}</strong><span className={timelineStyles.status} data-tone={status.tone}>{status.label}</span></div>; })}
      {pagination.totalPages > 1 ? <div className={timelineStyles.summaryPager}><button type="button" disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)}>Previous</button><span>Page {pagination.page} of {pagination.totalPages} · {pagination.total} programs</span><button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => onPageChange(pagination.page + 1)}>Next</button></div> : null}
    </div> : null}
  </section>;
}
