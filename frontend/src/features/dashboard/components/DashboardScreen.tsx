"use client";

import Link from "next/link";
import { PeriodPicker } from "@/components/ui/PeriodPicker";
import { CalendarCheck, CalendarX, ChartNoAxesCombined, Clock3, Coins, HandCoins } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
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
        </div>)}</div> : <div className="dashboard-empty-panel">No active Campaigns yet.</div>}
      </section>

      <section className="ui-card dashboard-panel" aria-label="Rupang sponsorship monitoring">
        <div className="dashboard-panel-header"><div><h2>Rupang sponsorship</h2><p>Current Time-Based coverage across all programs</p></div>{canViewMemberData ? <Link href="/member/data?programBalance=HAS_CARRY" className="dashboard-panel-link">View Members with carry →</Link> : null}</div>
        <div className="dashboard-member-metrics dashboard-sponsorship-metrics">
          <MetricCard label="Active subscriptions" value={(data?.sponsorshipSummary?.activeSubscriptions ?? 0).toLocaleString("id-ID")} detail="Currently valid" icon={<CalendarCheck size={19} />} tone="green" />
          <MetricCard label="Expiring soon" value={(data?.sponsorshipSummary?.expiringSoon ?? 0).toLocaleString("id-ID")} detail="Within 30 calendar days" icon={<Clock3 size={19} />} tone="gold" />
          <MetricCard label="Expired" value={(data?.sponsorshipSummary?.expiredSubscriptions ?? 0).toLocaleString("id-ID")} detail="Active records past validity" icon={<CalendarX size={19} />} tone="red" />
          <MetricCard label="Outstanding carry" value={formatMoney(data?.sponsorshipSummary?.outstandingCarryBalance ?? "0")} detail="Allocated TIME_BASED balance" icon={<HandCoins size={19} />} tone="maroon" />
          <MetricCard label="Subscriptions with carry" value={(data?.sponsorshipSummary?.subscriptionsWithCarryBalance ?? 0).toLocaleString("id-ID")} detail="Positive active balance" icon={<Coins size={19} />} tone="blue" />
        </div>
        {data?.sponsorshipSummary?.carryByEvent?.length ? <div className="dashboard-member-metrics dashboard-sponsorship-metrics" aria-label="Top programs by outstanding carry">
          {data.sponsorshipSummary.carryByEvent.map(event => <MetricCard key={event.eventCodeId} label={`${event.code} · ${event.eventName}`} value={formatMoney(event.amount)} detail="Outstanding carry" icon={<HandCoins size={19} />} tone="gold" />)}
        </div> : null}
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
