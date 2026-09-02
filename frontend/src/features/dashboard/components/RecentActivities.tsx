import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, FilePenLine, RotateCcw, UploadCloud } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import type { DashboardActivityType, DashboardSummary } from "../types";
import { DashboardPanelLoading } from "./DashboardPanelLoading";

function activityVisual(type: DashboardActivityType) {
  if (type === "STATEMENT_FINALIZED") return { icon: CheckCircle2, tone: "complete" };
  if (type === "APPROVAL_SUBMITTED") return { icon: Clock3, tone: "pending" };
  if (type === "STATEMENT_RETURNED") return { icon: RotateCcw, tone: "returned" };
  if (type === "INCOME_EDITED") return { icon: FilePenLine, tone: "edit" };
  return { icon: UploadCloud, tone: "upload" };
}

export function RecentActivities({ data, loading, canViewInquiry }: {
  data: DashboardSummary["recentActivities"];
  loading: boolean;
  canViewInquiry: boolean;
}) {
  return (
    <article className="ui-card dashboard-panel">
      <div className="dashboard-panel-header">
        <div>
          <h2>Recent Activities</h2>
          <p>Latest operational changes in the system</p>
        </div>
        {canViewInquiry ? <Link href="/reconciliation/transaction-inquiry" className="dashboard-panel-link">View All <ArrowRight size={13} /></Link> : null}
      </div>
      <div className="dashboard-activity-list">
        {loading ? (
          <DashboardPanelLoading label="Loading recent activities…" />
        ) : data.length === 0 ? (
          <div className="dashboard-empty-panel">No recent activities yet.</div>
        ) : data.map((activity) => {
          const visual = activityVisual(activity.type);
          const Icon = visual.icon;
          return (
            <div className="dashboard-activity-row" key={activity.id}>
              <span className={`dashboard-activity-icon ${visual.tone}`}><Icon size={16} /></span>
              <div className="dashboard-activity-copy">
                <strong>{activity.title}</strong>
                <span>{activity.detail}</span>
                <small>by {activity.actor}</small>
              </div>
              <time dateTime={activity.occurredAt}>{formatDateTime(activity.occurredAt)}</time>
            </div>
          );
        })}
      </div>
    </article>
  );
}
