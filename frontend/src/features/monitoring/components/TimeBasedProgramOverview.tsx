import { formatMoney } from "@/lib/format";
import type { TimeBasedMonitoringWorkspace } from "../types";
import styles from "./TimeBasedMonitoring.module.css";

export function TimeBasedProgramOverview({ rows }: { rows: TimeBasedMonitoringWorkspace["eventGroups"] }) {
  return <section className={styles.panel} aria-labelledby="time-program-overview-title">
    <div className={styles.sectionHeading}>
      <div><h2 id="time-program-overview-title">Program / Event Overview</h2><p>Active donor programs and their current coverage state, grouped by event.</p></div>
    </div>
    {!rows.length ? <p className={styles.empty}>No active TIME_BASED programs.</p> : <div className={styles.overviewScroll}>
      <div className={styles.overviewTable} role="table" aria-label="TIME_BASED program overview">
        <div className={styles.overviewHeader} role="row"><span role="columnheader">Program / Event</span><span role="columnheader">Current rule</span><span role="columnheader">Coverage</span><span role="columnheader">Carry</span></div>
        {rows.map(row => {
          const coveredRatio = row.activePrograms ? row.currentlyCovered / row.activePrograms * 100 : 0;
          return <div className={styles.overviewRow} role="row" key={row.code}>
            <div className={styles.eventIdentity} role="cell"><span className={styles.eventCode}>{row.code}</span><strong>{row.eventName}</strong></div>
            <div className={styles.rule} role="cell">{row.rule ? `${formatMoney(row.rule.unitAmount)} / ${row.rule.durationMonths} ${row.rule.durationMonths === 1 ? "month" : "months"}` : "Time Rule inactive"}</div>
            <div className={styles.coverageMetric} role="cell"><div className={styles.coverageTrack} role="meter" aria-label="Currently covered donor programs" aria-valuemin={0} aria-valuemax={row.activePrograms} aria-valuenow={row.currentlyCovered}><i style={{ width: `${coveredRatio}%` }} /></div><span>{row.currentlyCovered} / {row.activePrograms} covered</span>{row.activePrograms > 0 && row.currentlyCovered === row.activePrograms ? <em>Fully covered</em> : null}</div>
            <strong className={styles.eventCarry} role="cell">{formatMoney(row.outstandingCarry)}</strong>
          </div>;
        })}
      </div>
    </div>}
  </section>;
}
