"use client";

import { MonthPicker } from "@/components/ui/MonthPicker";
import { useAuthSession } from "@/features/auth/context/AuthSessionContext";
import { formatDateTime } from "@/lib/format";
import { DashboardMetrics } from "./DashboardMetrics";
import { RecentActivities } from "./RecentActivities";
import { StatementStatus } from "./StatementStatus";
import { TopFinalEvents } from "./TopFinalEvents";
import { TransactionStatus } from "./TransactionStatus";
import { TransactionTrend } from "./TransactionTrend";
import { useDashboardWorkspace } from "../hooks/useDashboardWorkspace";

export function DashboardScreen() {
  const user = useAuthSession();
  const { month, setMonth, data, loading, error } = useDashboardWorkspace();
  const monthLabel = data?.filters.monthLabel ?? "selected month";
  const trendRange = data?.trend.length
    ? `${data.trend[0].label} – ${data.trend[data.trend.length - 1].label}`
    : "Historical 6-month view";
  const canViewInquiry = user.menuCodes.includes("RECON_TRANSACTION_INQUIRY");

  return (
    <div className="page-stack dashboard-page" aria-busy={loading}>
      <section className="dashboard-welcome">
        <div>
          <h1>Welcome back, {data?.viewer.fullName ?? user.fullName} <span aria-hidden="true">👋</span></h1>
          <p>Here&apos;s what&apos;s happening with your reconciliation operations.</p>
        </div>
        <MonthPicker value={month} onChange={setMonth} disabled={loading} ariaLabel="Dashboard month" />
      </section>

      {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}

      <DashboardMetrics data={data} loading={loading} />

      <section className="dashboard-main-grid">
        <article className="ui-card dashboard-panel dashboard-trend-panel">
          <div className="dashboard-panel-header">
            <div>
              <h2>6-Month Transaction Trend</h2>
              <p>{trendRange} · monthly cards above show only {monthLabel}</p>
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

      <footer className="dashboard-footer-note">
        <span>All amounts are in IDR · Dashboard auto-refreshes every 5 minutes</span>
        <span>{data?.lastUpdatedAt ? `Last updated ${formatDateTime(data.lastUpdatedAt)}` : ""}</span>
      </footer>
    </div>
  );
}
