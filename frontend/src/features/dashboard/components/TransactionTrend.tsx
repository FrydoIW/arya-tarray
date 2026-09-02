"use client";

import { useMemo } from "react";
import type { DashboardSummary } from "../types";
import { compactMoney } from "../utils/dashboard.utils";
import { DashboardPanelLoading } from "./DashboardPanelLoading";

export function TransactionTrend({ points, loading }: { points: DashboardSummary["trend"]; loading: boolean }) {
  const geometry = useMemo(() => {
    if (!points.length) return null;

    const width = 760;
    const height = 250;
    const left = 30;
    const right = 18;
    const top = 22;
    const bottom = 38;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const maxAmount = Math.max(...points.flatMap((point) => [Number(point.incoming), Number(point.outgoing)]), 0);
    const maxTransactions = Math.max(...points.map((point) => point.transactions), 0);
    const amountScale = Math.max(maxAmount, 1);
    const transactionScale = Math.max(maxTransactions, 1);
    const groupWidth = plotWidth / points.length;
    const barWidth = Math.min(18, Math.max(10, groupWidth * 0.18));

    const bars = points.map((point, index) => {
      const centerX = left + groupWidth * index + groupWidth / 2;
      const incomingHeight = (Number(point.incoming) / amountScale) * plotHeight;
      const outgoingHeight = (Number(point.outgoing) / amountScale) * plotHeight;
      return {
        incomingX: centerX - barWidth - 2,
        outgoingX: centerX + 2,
        incomingY: top + plotHeight - incomingHeight,
        outgoingY: top + plotHeight - outgoingHeight,
        incomingHeight,
        outgoingHeight
      };
    });

    const linePoints = points.map((point, index) => ({
      x: left + groupWidth * index + groupWidth / 2,
      y: top + plotHeight - (point.transactions / transactionScale) * plotHeight
    }));
    const line = linePoints.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");

    return { width, height, left, right, top, plotWidth, plotHeight, maxAmount, maxTransactions, barWidth, bars, linePoints, line };
  }, [points]);

  if (loading) return <DashboardPanelLoading label="Loading transaction trend…" />;
  if (!geometry) return <div className="dashboard-empty-panel">No transaction trend is available for this period.</div>;

  return (
    <div className="dashboard-trend-content">
      <div className="dashboard-chart-legend">
        <span><i className="dashboard-legend-box incoming" /> Incoming (Credit)</span>
        <span><i className="dashboard-legend-box outgoing" /> Outgoing (Debit)</span>
        <span><i className="dashboard-legend-line" /> Transactions</span>
      </div>

      <svg className="dashboard-trend-chart" viewBox={`0 0 ${geometry.width} ${geometry.height}`} role="img" aria-label="Six month incoming, outgoing and transaction trend">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = geometry.top + geometry.plotHeight * ratio;
          return <line key={ratio} x1={geometry.left} x2={geometry.width - geometry.right} y1={y} y2={y} className="dashboard-chart-grid" />;
        })}

        {geometry.bars.map((bar, index) => (
          <g key={points[index].month}>
            <rect x={bar.incomingX} y={bar.incomingY} width={geometry.barWidth} height={Math.max(0, bar.incomingHeight)} rx="3" className="dashboard-bar-incoming" />
            <rect x={bar.outgoingX} y={bar.outgoingY} width={geometry.barWidth} height={Math.max(0, bar.outgoingHeight)} rx="3" className="dashboard-bar-outgoing" />
          </g>
        ))}

        <path d={geometry.line} className="dashboard-transaction-line" />
        {geometry.linePoints.map((point, index) => (
          <circle key={points[index].month} cx={point.x} cy={point.y} r="4" className="dashboard-transaction-dot" />
        ))}

        {points.map((point, index) => {
          const x = geometry.left + geometry.plotWidth / points.length * index + geometry.plotWidth / points.length / 2;
          return <text key={point.month} x={x} y={geometry.height - 10} textAnchor="middle" className="dashboard-chart-label">{point.label}</text>;
        })}
      </svg>

      <div className="dashboard-chart-foot">
        <span>Peak amount {compactMoney(geometry.maxAmount)}</span>
        <span>Peak volume {geometry.maxTransactions.toLocaleString("id-ID")} transactions</span>
      </div>
    </div>
  );
}
