"use client";

import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { formatMoney } from "@/lib/format";
import { getWorkspaceCache, readWorkspace, workspaceCacheKey } from "@/lib/workspace-cache";
import { getCampaignMonitoring } from "../api/monitoring.api";
import { CAMPAIGN_MONITORING_WORKSPACE_PREFIX } from "../monitoring-cache";
import type { CampaignMonitoringWorkspace } from "../types";
import styles from "../styles/monitoring.module.css";

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
  return <main className={styles.page}><header><div><span>MONITORING</span><h1>Campaign Monitoring</h1><p>Direct bank contribution, target application, and donor-owned carry are shown separately.</p></div></header>{error ? <div className="ui-alert ui-alert-error">{error}</div> : null}<section className={styles.metrics}>{[["Active Campaigns", data?.summary.activeCampaigns ?? 0], ["Scheduled", data?.summary.scheduledCampaigns ?? 0], ["Target Applied", formatMoney(data?.summary.totalTargetApplied ?? "0")], ["Remaining", formatMoney(data?.summary.totalRemaining ?? "0")], ["Campaign Carry", formatMoney(data?.summary.outstandingCampaignCarry ?? "0")]].map(([label, value]) => <MetricCard key={String(label)} label={String(label)} value={String(value)} detail="Current state" icon={<Gift size={18} />} tone="gold" />)}</section><section className={styles.panel}><h2>Campaign target state</h2>{data?.campaigns.map(row => <article className={styles.campaign} key={row.campaignId}><header><div><strong>{row.eventCode.code} · {row.eventCode.eventName}</strong><h3>{row.campaignName}</h3></div><em>{row.displayStatus}</em></header><div className={styles.facts}><span>Direct Contribution<b>{formatMoney(row.directContribution)}</b></span><span>Carry Allocation<b>{formatMoney(row.carryAllocation)}</b></span><span>Target Applied<b>{formatMoney(row.targetApplied)}</b></span><span>Campaign Carry<b>{formatMoney(row.campaignCarry)}</b></span>{row.targetAmount ? <span>Remaining<b>{formatMoney(row.remainingAmount ?? "0")}</b></span> : <span>Target<b>Unlimited</b></span>}</div>{row.targetAmount ? <div className={styles.progress}><i style={{ width: `${Math.min(100, row.progressPercent ?? 0)}%` }} /><small>{Math.round(row.progressPercent ?? 0)}% · {formatMoney(row.targetApplied)} / {formatMoney(row.targetAmount)}</small></div> : null}</article>) ?? "Loading…"}</section></main>;
}
