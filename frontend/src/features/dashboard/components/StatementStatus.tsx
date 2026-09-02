import type { DashboardSummary } from "../types";
import { DashboardPanelLoading } from "./DashboardPanelLoading";

export function StatementStatus({ data, loading }: { data: DashboardSummary["statementStatus"]; loading: boolean }) {
  const rows = [
    { label: "Draft", value: data.draft, className: "draft" },
    { label: "Pending Approval", value: data.pendingApproval, className: "pending" },
    { label: "Complete", value: data.complete, className: "complete" }
  ];

  if (loading) return <DashboardPanelLoading label="Loading statement status…" />;

  return (
    <div className="dashboard-statement-status">
      {rows.map((row) => {
        const percent = data.total ? (row.value / data.total) * 100 : 0;
        return (
          <div className="dashboard-statement-status-row" key={row.label}>
            <span className={`dashboard-statement-dot ${row.className}`} />
            <span>{row.label}</span>
            <strong>{row.value.toLocaleString("id-ID")}</strong>
            <small>{percent.toLocaleString("en-US", { maximumFractionDigits: 1 })}%</small>
            <div className="dashboard-progress-track"><i className={row.className} style={{ width: `${percent}%` }} /></div>
          </div>
        );
      })}
      <div className="dashboard-statement-total"><span>Total</span><strong>{data.total.toLocaleString("id-ID")}</strong></div>
    </div>
  );
}
