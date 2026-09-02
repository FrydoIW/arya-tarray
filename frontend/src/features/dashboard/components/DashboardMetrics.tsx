import { ArrowDownToLine, ArrowUpFromLine, BadgeCheck, FileText, ListChecks } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { formatMoney } from "@/lib/format";
import type { DashboardSummary } from "../types";
import { changeDetail } from "../utils/dashboard.utils";

export function DashboardMetrics({ data, loading }: { data: DashboardSummary | null; loading: boolean }) {
  return (
    <section className="dashboard-metrics">
      <MetricCard
        label="Total Statements"
        value={loading && !data ? "—" : (data?.metrics.totalStatements.value ?? 0).toLocaleString("id-ID")}
        detail={changeDetail(data?.metrics.totalStatements.changePercent)}
        icon={<FileText size={20} />}
        tone="blue"
      />
      <MetricCard
        label="Total Transactions"
        value={loading && !data ? "—" : (data?.metrics.totalTransactions.value ?? 0).toLocaleString("id-ID")}
        detail={changeDetail(data?.metrics.totalTransactions.changePercent)}
        icon={<ListChecks size={20} />}
        tone="green"
      />
      <MetricCard
        label="Total Incoming"
        value={loading && !data ? "—" : formatMoney(data?.metrics.totalIncoming.value ?? 0)}
        detail={changeDetail(data?.metrics.totalIncoming.changePercent)}
        icon={<ArrowDownToLine size={20} />}
        tone="violet"
      />
      <MetricCard
        label="Total Outgoing"
        value={loading && !data ? "—" : formatMoney(data?.metrics.totalOutgoing.value ?? 0)}
        detail={changeDetail(data?.metrics.totalOutgoing.changePercent)}
        icon={<ArrowUpFromLine size={20} />}
        tone="gold"
      />
      <MetricCard
        label="Complete Transactions"
        value={loading && !data ? "—" : (data?.metrics.completeTransactions.value ?? 0).toLocaleString("id-ID")}
        detail={changeDetail(data?.metrics.completeTransactions.changePercent)}
        icon={<BadgeCheck size={20} />}
        tone="green"
      />
    </section>
  );
}
