import { CircleGauge, WalletCards } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { TimeBasedMonitoringWorkspace } from "../types";
import styles from "../styles/monitoring.module.css";

export function TimeBasedProgramOverview({ rows }: { rows: TimeBasedMonitoringWorkspace["eventGroups"] }) {
  return <section className={styles.panel} aria-labelledby="time-program-overview-title">
    <div className={styles.sectionHeading}>
      <div><h2 id="time-program-overview-title">Program / Event Overview</h2><p>Active programs and their current coverage state, grouped by event.</p></div>
      <span className={styles.legend}><i /> Currently covered <b /> Not currently covered</span>
    </div>
    {!rows.length ? <p className={styles.empty}>No active TIME_BASED programs.</p> : <div className={styles.overviewTable}>
      {rows.map(row => {
        const coveredRatio = row.activePrograms ? row.currentlyCovered / row.activePrograms * 100 : 0;
        return <article className={styles.overviewRow} key={row.code}>
          <div className={styles.eventIdentity}><span>{row.code}</span><strong>{row.eventName}</strong><small>{row.rule ? `${formatMoney(row.rule.unitAmount)} / ${row.rule.durationMonths} ${row.rule.durationMonths === 1 ? "month" : "months"}` : "Time Rule inactive"}</small></div>
          <div className={styles.coverageMetric}>
            <div className={styles.coverageTrack} aria-label={`${row.currentlyCovered} of ${row.activePrograms} programs currently covered`}><i style={{ width: `${coveredRatio}%` }} /></div>
            <span><CircleGauge size={13} /> {row.currentlyCovered} / {row.activePrograms} covered</span>
          </div>
          <div className={styles.eventCarry}><span><WalletCards size={13} /> Carry</span><strong>{formatMoney(row.outstandingCarry)}</strong></div>
        </article>;
      })}
    </div>}
  </section>;
}
