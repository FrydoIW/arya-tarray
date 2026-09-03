import { ArrowDownToLine, ArrowUpFromLine, BadgeCheck, ListChecks } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { formatMoney } from "@/lib/format";
import type { TransactionInquiryWorkspace } from "../types";
import type { TransactionInquiryPeriodMode } from "../types";
import { periodContext } from "../utils/transaction-inquiry.utils";
import styles from "../styles/transaction-inquiry.module.css";

export function TransactionInquirySummary({ summary, periodMode, month, date }: { summary: TransactionInquiryWorkspace["summary"]; periodMode: TransactionInquiryPeriodMode; month: string; date: string }) {
  const context = periodContext(periodMode, month, date);
  return (
    <section className={styles.metrics}>
      <MetricCard label="Total Transactions" value={summary.totalTransactions.toLocaleString("en-US")} detail={context} icon={<ListChecks size={20} />} tone="blue" />
      <MetricCard label="Total Credit" value={formatMoney(summary.totalCredit)} detail={`${summary.incomingTransactions.toLocaleString("en-US")} incoming transactions`} icon={<ArrowDownToLine size={20} />} tone="green" />
      <MetricCard label="Total Debit" value={formatMoney(summary.totalDebit)} detail={`${summary.outgoingTransactions.toLocaleString("en-US")} outgoing transactions`} icon={<ArrowUpFromLine size={20} />} tone="gold" />
      <MetricCard label="Complete Transactions" value={summary.completeTransactions.toLocaleString("en-US")} detail={summary.totalTransactions ? `${((summary.completeTransactions / summary.totalTransactions) * 100).toFixed(1)}% of filtered transactions` : "no filtered transactions"} icon={<BadgeCheck size={20} />} tone="violet" />
    </section>
  );
}
