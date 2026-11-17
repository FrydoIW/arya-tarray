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

      <article className="ui-card dashboard-panel">
        <div className="dashboard-panel-header"><div><h2>Physical Item Sales</h2><p>Separate sales and inventory view for {monthLabel}; excluded from donation analytics.</p></div><span>ITEM_SALE</span></div>
        {loading && !data ? <p>Loading item sales…</p> : <div className="dashboard-item-sales">
          <div><span>Confirmed sales</span><strong>{data?.itemSales.confirmedPurchases ?? 0}</strong></div>
          <div><span>Units sold</span><strong>{data?.itemSales.confirmedQuantity ?? 0}</strong></div>
          <div><span>Sales amount</span><strong>{formatMoney(data?.itemSales.confirmedAmount ?? "0")}</strong></div>
          <div><span>Pending resolution</span><strong>{data?.itemSales.pendingPurchases ?? 0}</strong></div>
          <div><span>Reversed</span><strong>{data?.itemSales.reversedPurchases ?? 0}</strong></div>
          {(data?.itemSales.items ?? []).map(item => <div key={item.eventCodeChildId}><span>{item.childCode} · {item.childName}</span><strong>{item.quantity} sold · {item.stockOnHand ?? "—"} on hand</strong></div>)}
        </div>}
      </article>

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
