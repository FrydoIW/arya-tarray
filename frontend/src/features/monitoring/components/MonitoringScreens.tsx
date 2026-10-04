"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CircleDollarSign, Gift, Target, WalletCards } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { formatMoney } from "@/lib/format";
import { getWorkspaceCache, readWorkspace, workspaceCacheKey } from "@/lib/workspace-cache";
import { getCampaignMonitoring } from "../api/monitoring.api";
import { CAMPAIGN_MONITORING_WORKSPACE_PREFIX } from "@/lib/monitoring-cache";
import type { CampaignMonitoringWorkspace } from "../types";
import { CampaignTargetCard } from "./CampaignTargetCard";
import styles from "./CampaignMonitoring.module.css";

function useCampaignWorkspace() {
  const key = workspaceCacheKey(CAMPAIGN_MONITORING_WORKSPACE_PREFIX, {});
  const [data, setData] = useState<CampaignMonitoringWorkspace | null>(() => getWorkspaceCache<CampaignMonitoringWorkspace>(key)?.value ?? null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const read = readWorkspace(key, signal => getCampaignMonitoring(signal));
    if (read.cached) setData(read.cached);
    (read.promise ?? Promise.resolve(read.cached!)).then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Gagal memuat monitoring."); })
      .finally(read.release);
    return () => controller.abort();
  }, [key]);
  return { data, error };
}

export function CampaignMonitoringScreen() {
  const { data, error } = useCampaignWorkspace();

  return <main className={styles.page}>
    <header className={styles.pageHead}>
      <div className={styles.titleBlock}><span className={styles.eyebrow}>MONITORING / CAMPAIGN</span><h1>Campaign Monitoring</h1><p>Direct bank contribution, target application, and donor-owned carry are shown separately.</p></div>
    </header>
    {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}
    {data ? <>
      <section className={styles.metrics} aria-label="Campaign summary">
        <MetricCard label="Active Campaigns" value={data.summary.activeCampaigns} detail="Current state" icon={<Gift size={19} />} tone="gold" />
        <MetricCard label="Scheduled" value={data.summary.scheduledCampaigns} detail="Current state" icon={<CalendarDays size={19} />} tone="gold" />
        <MetricCard label="Target Applied" value={formatMoney(data.summary.totalTargetApplied)} detail="Current state" icon={<Target size={19} />} tone="gold" />
        <MetricCard label="Remaining" value={formatMoney(data.summary.totalRemaining)} detail="Current state" icon={<CircleDollarSign size={19} />} tone="gold" />
        <MetricCard label="Campaign Carry" value={formatMoney(data.summary.outstandingCampaignCarry)} detail="Current state" icon={<WalletCards size={19} />} tone="gold" />
      </section>
      <section className={styles.portfolio} aria-labelledby="campaign-target-title">
        <div className={styles.sectionHeading}><div><h2 id="campaign-target-title">Campaign target state</h2><p>Direct contribution, carry allocation, target application, and remaining balances by campaign.</p></div></div>
        {data.campaigns.length ? <div className={styles.campaignList}>{data.campaigns.map(row => <CampaignTargetCard key={row.campaignId} campaign={row} />)}</div> : <p className={styles.empty}>No campaigns to display.</p>}
      </section>
    </> : !error ? <section className={styles.loadingPanel} role="status"><Gift size={19} /><span>Loading Campaign Monitoring…</span></section> : null}
  </main>;
}
