import { AlertCircle, CheckCircle2, CircleDollarSign, Rows3 } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { formatMoney } from "@/lib/format";
import type { SignApprovalDetail } from "../types";
import styles from "../styles/sign-approval.module.css";

type ApprovalDetailSummaryProps = {
  summary: SignApprovalDetail["summary"];
};

export function ApprovalDetailSummary({ summary }: ApprovalDetailSummaryProps) {
  return (
    <section className={styles.detailMetrics}>
      <MetricCard
        label="Total Transactions"
        value={summary.totalTransactions.toLocaleString("id-ID")}
        detail="transactions in this statement"
        icon={<Rows3 size={20} />}
        tone="blue"
      />
      <MetricCard
        label="Total Amount"
        value={formatMoney(summary.totalAmount)}
        detail="total credit plus debit"
        icon={<CircleDollarSign size={20} />}
        tone="green"
      />
      <MetricCard
        label="Checked Transactions"
        value={summary.checkedTransactions.toLocaleString("id-ID")}
        detail="transactions currently in CHECK status"
        icon={<CheckCircle2 size={20} />}
        tone="violet"
      />
      <MetricCard
        label="Need Review"
        value={summary.needsReviewTransactions.toLocaleString("id-ID")}
        detail="transactions not currently in CHECK status"
        icon={<AlertCircle size={20} />}
        tone="gold"
      />
    </section>
  );
}
