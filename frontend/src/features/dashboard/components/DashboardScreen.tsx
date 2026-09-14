"use client";

import { PeriodPicker } from "@/components/ui/PeriodPicker";
import { ChartNoAxesCombined } from "lucide-react";
import { useAuthSession } from "@/features/auth/context/AuthSessionContext";
import { formatDateTime, formatMoney } from "@/lib/format";
import { DashboardMetrics } from "./DashboardMetrics";
import { RecentActivities } from "./RecentActivities";
import { StatementStatus } from "./StatementStatus";
import { TopFinalEvents } from "./TopFinalEvents";
import { TransactionStatus } from "./TransactionStatus";
import { TransactionTrend } from "./TransactionTrend";
import { MemberDashboardSection } from "./MemberDashboardSection";
import { useDashboardWorkspace } from "../hooks/useDashboardWorkspace";
import { currentDayValue, currentMonthValue } from "../utils/dashboard.utils";

export function DashboardScreen() {
  const user = useAuthSession();
  const { period, changePeriod, data, loading, error } = useDashboardWorkspace();
  const monthLabel = data?.filters.monthLabel ?? "selected month";
  const trendRange = data?.trend.length
    ? `${data.trend[0].label} – ${data.trend[data.trend.length - 1].label}`
    : "Historical 6-month view";
  const canViewInquiry = user.menuCodes.includes("RECON_TRANSACTION_INQUIRY");
  const canViewMemberData = user.menuCodes.includes("MEMBER_DATA");
  const canViewMemberRegistration = user.menuCodes.includes("MEMBER_REGISTRATION");

  return (
    <div className="page-stack dashboard-page" aria-busy={loading}>
      {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}

      <div className="dashboard-section-heading">
        <div><ChartNoAxesCombined size={18} aria-hidden="true" /><h2>At a glance</h2><span className="dashboard-section-caption">Your selected period</span></div>
        <PeriodPicker value={period} maxMonth={currentMonthValue()} maxDate={currentDayValue()} onChange={changePeriod} disabled={loading} ariaLabel="Dashboard period" />
      </div>
      <DashboardMetrics data={data} loading={loading} comparisonLabel={data?.filters.comparisonLabel ?? (period.mode === "DAY" ? "vs previous day" : "vs last month")} />

      <section className="dashboard-main-grid">
        <article className="ui-card dashboard-panel dashboard-trend-panel">
          <div className="dashboard-panel-header">
            <div>
              <h2>6-Month Transaction Trend</h2>
              <p>{trendRange} · monthly totals across six months</p>
            </div>
            <span>Historical</span>
          </div>
          <TransactionTrend points={data?.trend ?? []} loading={loading && !data} />
        </article>

        <article className="ui-card dashboard-panel dashboard-status-panel">
          <div className="dashboard-panel-header">
            <div>
              <h2>Transactions by Status</h2>
              <p>Current transaction lifecycle for {monthLabel}</p>
            </div>
          </div>
          <TransactionStatus loading={loading && !data} data={data?.transactionStatus ?? { draft: 0, needsReview: 0, pendingApproval: 0, complete: 0, total: 0 }} />
        </article>
      </section>

      <section className="dashboard-bottom-grid">
        <article className="ui-card dashboard-panel">
          <div className="dashboard-panel-header">
            <div>
              <h2>Statements by Status</h2>
              <p>Statement processing status for {monthLabel}</p>
            </div>
          </div>
          <StatementStatus loading={loading && !data} data={data?.statementStatus ?? { draft: 0, pendingApproval: 0, complete: 0, total: 0 }} />
        </article>

        <TopFinalEvents
          data={data?.eventGroups ?? []}
          loading={loading && !data}
          monthLabel={monthLabel}
          canViewInquiry={canViewInquiry}
        />

        <RecentActivities
          data={data?.recentActivities ?? []}
          loading={loading && !data}
          canViewInquiry={canViewInquiry}
        />
      </section>

      <section className="ui-card dashboard-panel dashboard-campaigns" aria-label="Campaign monitoring">
        <div className="dashboard-panel-header"><div><h2>Campaign monitoring</h2><p>Official finalized incoming funds across active and upcoming Campaigns</p></div></div>
        {data?.campaigns?.length ? <div className="dashboard-campaign-grid">{data.campaigns.map((campaign) => <div className="dashboard-campaign-item" key={campaign.id}>
          <div><strong>{campaign.campaignName}</strong><span>{campaign.eventCode.code} · {campaign.eventCode.eventName}</span></div>
          <div className="dashboard-campaign-amount">Rp{Number(campaign.collectedAmount).toLocaleString("id-ID")}{campaign.targetAmount ? ` / Rp${Number(campaign.targetAmount).toLocaleString("id-ID")}` : ""}</div>
          {campaign.targetAmount && <><div className="dashboard-campaign-track"><span style={{ width: `${Math.min(100, Math.max(0, campaign.progressPercent ?? 0))}%` }} /></div><small>{Math.round(campaign.progressPercent ?? 0)}%{campaign.targetReached ? " · Target reached" : ""}</small></>}
          <small>{campaign.displayStatus === "SCHEDULED" ? "Scheduled" : "Active"}{campaign.startDate || campaign.endDate ? ` · ${campaign.startDate ?? "Anytime"} – ${campaign.endDate ?? "Open"}` : ""}</small>
        </div>)}</div> : <p className="dashboard-campaign-empty">No active Campaigns yet.</p>}
      </section>

      <section className="ui-card dashboard-panel" aria-label="Rupang sponsorship monitoring">
        <div className="dashboard-panel-header"><div><h2>Rupang sponsorship</h2><p>Current Time-Based coverage across all programs</p></div></div>
        <div className="dashboard-member-metrics">
          <div className="metric-card"><span>Active subscriptions</span><strong>{(data?.sponsorshipSummary?.activeSubscriptions ?? 0).toLocaleString("id-ID")}</strong><small>Currently valid</small></div>
          <div className="metric-card"><span>Expiring soon</span><strong>{(data?.sponsorshipSummary?.expiringSoon ?? 0).toLocaleString("id-ID")}</strong><small>Within 30 calendar days</small></div>
          <div className="metric-card"><span>Expired</span><strong>{(data?.sponsorshipSummary?.expiredSubscriptions ?? 0).toLocaleString("id-ID")}</strong><small>Active records past validity</small></div>
          <div className="metric-card"><span>Outstanding carry</span><strong>{formatMoney(data?.sponsorshipSummary?.outstandingCarryBalance ?? "0")}</strong><small>Allocated TIME_BASED balance</small></div>
          <div className="metric-card"><span>Subscriptions with carry</span><strong>{(data?.sponsorshipSummary?.subscriptionsWithCarryBalance ?? 0).toLocaleString("id-ID")}</strong><small>Positive active balance</small></div>
        </div>
      </section>

      <MemberDashboardSection
        data={data}
        loading={loading && !data}
        periodLabel={data?.filters.periodLabel ?? monthLabel}
        canViewMemberData={canViewMemberData}
        canViewMemberRegistration={canViewMemberRegistration}
      />

      <footer className="dashboard-footer-note">
        <span>All amounts are in IDR · Dashboard auto-refreshes every 5 minutes</span>
        <span>{data?.lastUpdatedAt ? `Last updated ${formatDateTime(data.lastUpdatedAt)}` : ""}</span>
      </footer>
    </div>
  );
}
