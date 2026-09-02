import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { DashboardSummary } from "../types";

export function TopFinalEvents({ data, loading, monthLabel, canViewInquiry }: {
  data: DashboardSummary["topFinalEvents"];
  loading: boolean;
  monthLabel: string;
  canViewInquiry: boolean;
}) {
  return (
    <article className="ui-card dashboard-panel">
      <div className="dashboard-panel-header">
        <div>
          <h2>Top 5 Final Events</h2>
          <p>Largest finalized income classifications by incoming amount</p>
        </div>
        {canViewInquiry ? <Link href="/reconciliation/transaction-inquiry" className="dashboard-panel-link">View inquiry <ArrowRight size={13} /></Link> : null}
      </div>
      <div className="dashboard-event-table-wrap">
        <table className="dashboard-event-table">
          <thead><tr><th>Event Code</th><th>Event Name</th><th>Transactions</th><th>Amount</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="dashboard-table-empty"><span role="status">Loading event data…</span></td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={4} className="dashboard-table-empty">No finalized event data in {monthLabel}.</td></tr>
            ) : data.map((event) => (
              <tr key={event.eventCodeId}>
                <td><strong>{event.code}</strong></td>
                <td>{event.eventName}</td>
                <td>{event.transactions.toLocaleString("id-ID")}</td>
                <td>{formatMoney(event.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
