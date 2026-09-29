import { formatMoney } from "@/lib/format";
import type { CampaignMonitoringWorkspace } from "../types";
import styles from "./CampaignMonitoring.module.css";

type Campaign = CampaignMonitoringWorkspace["campaigns"][number];

export function CampaignTargetCard({ campaign: row }: { campaign: Campaign }) {
  return <article className={styles.campaign}>
    <header className={styles.campaignHead}>
      <div className={styles.campaignIdentity}><span className={styles.eventCode}>{row.eventCode.code}</span><div><strong>{row.eventCode.eventName}</strong><h3>{row.campaignName}</h3></div></div>
      <em className={styles.status} data-status={row.displayStatus}>{row.displayStatus}</em>
    </header>
    <div className={styles.campaignBody}>
      <div className={styles.fundingBlock}>
        <h4>Funding composition</h4>
        <dl className={styles.financeList}>
          <div><dt>Direct Contribution</dt><dd>{formatMoney(row.directContribution)}</dd></div>
          <div><dt>Carry Allocation</dt><dd>{formatMoney(row.carryAllocation)}</dd></div>
          <div className={styles.applied}><dt>Target Applied</dt><dd>{formatMoney(row.targetApplied)}</dd></div>
        </dl>
      </div>
      <div className={styles.targetBlock}>
        <h4>Target position</h4>
        <dl className={styles.financeList}>
          {row.targetAmount ? <div><dt>Remaining</dt><dd>{formatMoney(row.remainingAmount ?? "0")}</dd></div> : <div><dt>Target</dt><dd>Unlimited</dd></div>}
          <div><dt>Campaign Carry</dt><dd>{formatMoney(row.campaignCarry)}</dd></div>
        </dl>
        {row.targetAmount ? <div className={styles.progressBlock}>
          <div className={styles.progressText}><span>Target progress</span><strong>{Math.round(row.progressPercent ?? 0)}%</strong></div>
          <div className={styles.progressTrack}><i style={{ width: `${Math.min(100, row.progressPercent ?? 0)}%` }} /></div>
          <small>{formatMoney(row.targetApplied)} / {formatMoney(row.targetAmount)}</small>
        </div> : null}
      </div>
    </div>
  </article>;
}
