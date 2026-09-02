import type { DashboardSummary } from "../types";
import { DashboardPanelLoading } from "./DashboardPanelLoading";

export function TransactionStatus({ data, loading }: { data: DashboardSummary["transactionStatus"]; loading: boolean }) {
  const entries = [
    { key: "complete", label: "Complete", value: data.complete, color: "#2eb36b" },
    { key: "pending", label: "Pending Approval", value: data.pendingApproval, color: "#f4a51c" },
    { key: "draft", label: "Draft", value: data.draft, color: "#2f6fed" },
    { key: "review", label: "Needs Review", value: data.needsReview, color: "#7c55d9" }
  ];

  let cursor = 0;
  const stops = entries.map((entry) => {
    const start = cursor;
    const size = data.total ? (entry.value / data.total) * 100 : 0;
    cursor += size;
    return `${entry.color} ${start}% ${cursor}%`;
  });
  const background = data.total ? `conic-gradient(${stops.join(", ")})` : "#edf1f7";

  if (loading) return <DashboardPanelLoading label="Loading transaction status…" />;

  return (
    <div className="dashboard-status-layout">
      <div className={`dashboard-donut ${data.total === 0 ? "is-empty" : ""}`} style={{ background }}>
        <div className="dashboard-donut-hole">
          <strong>{data.total === 0 ? "—" : data.total.toLocaleString("id-ID")}</strong>
          <span>{data.total === 0 ? "No data" : "Total"}</span>
        </div>
      </div>
      <div className="dashboard-status-legend">
        {entries.map((entry) => {
          const percent = data.total ? (entry.value / data.total) * 100 : 0;
          return (
            <div key={entry.key}>
              <span className="dashboard-status-label"><i style={{ background: entry.color }} />{entry.label}</span>
              <strong>{entry.value.toLocaleString("id-ID")} <small>({percent.toLocaleString("en-US", { maximumFractionDigits: 1 })}%)</small></strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}
