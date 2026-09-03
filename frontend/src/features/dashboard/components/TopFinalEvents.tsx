"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { DashboardSummary } from "../types";

export function TopFinalEvents({ data, loading, monthLabel, canViewInquiry }: {
  data: DashboardSummary["eventGroups"];
  loading: boolean;
  monthLabel: string;
  canViewInquiry: boolean;
}) {
  const accordionId = useId();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  function toggle(category: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  return (
    <article className="ui-card dashboard-panel">
      <div className="dashboard-panel-header">
        <div>
          <h2>Final Event Categories</h2>
          <p>Finalized incoming classifications grouped by Event Code category</p>
        </div>
        {canViewInquiry ? <Link href="/reconciliation/transaction-inquiry" className="dashboard-panel-link">View inquiry <ArrowRight size={13} /></Link> : null}
      </div>
      <div className="dashboard-event-accordion">
        {loading ? <div className="dashboard-table-empty"><span role="status">Loading event data…</span></div> : null}
        {!loading && data.length === 0 ? <div className="dashboard-table-empty">No finalized event data in {monthLabel}.</div> : null}
        {!loading ? data.map((group, index) => {
          const expandedGroup = expanded.has(group.category);
          const panelId = `${accordionId}-group-${index}`;
          return (
            <section className="dashboard-event-group" key={group.category}>
              <button type="button" className="dashboard-event-group-trigger" aria-expanded={expandedGroup} aria-controls={panelId} onClick={() => toggle(group.category)}>
                <span className="dashboard-event-group-title"><ChevronDown size={16} className={expandedGroup ? "is-expanded" : ""} aria-hidden="true" /><strong>{group.category}</strong></span>
                <span className="dashboard-event-group-metrics"><span>{group.transactionCount.toLocaleString("id-ID")} transactions</span><strong>{formatMoney(group.totalAmount)}</strong></span>
              </button>
              {expandedGroup ? (
                <div id={panelId} className="dashboard-event-group-content">
                  {group.events.map((event) => (
                    <div className="dashboard-event-row" key={event.eventCodeId}>
                      <strong>{event.code}</strong>
                      <span>{event.eventName}</span>
                      <small>{event.transactionCount.toLocaleString("id-ID")} transactions</small>
                      <em>{formatMoney(event.totalAmount)}</em>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          );
        }) : null}
      </div>
    </article>
  );
}
