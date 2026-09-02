import { CheckCircle2, Clock3, ListChecks, PencilLine } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import type { EditIncomeWorkspace } from "../types";
import { formatMonthLabel } from "../utils/edit-income.utils";
import styles from "../styles/edit-income.module.css";

type Props = {
  summary: EditIncomeWorkspace["summary"];
  modifiedTransactions: number;
  month: string;
};

export function EditIncomeSummary({ summary, modifiedTransactions, month }: Props) {
  const monthLabel = formatMonthLabel(month);
  return (
    <section className={styles.metrics}>
      <MetricCard label="Finalized Statements" value={summary.finalizedStatements} detail={`available in ${monthLabel}`} icon={<CheckCircle2 size={20} />} tone="green" />
      <MetricCard label="Total Transactions" value={summary.totalTransactions.toLocaleString("en-US")} detail={`finalized in ${monthLabel}`} icon={<ListChecks size={20} />} tone="blue" />
      <MetricCard label="Modified Transactions" value={modifiedTransactions} detail="not yet submitted" icon={<PencilLine size={20} />} tone="gold" />
      <MetricCard label="Pending Re-approval" value={summary.pendingReapproval} detail={`in ${monthLabel}`} icon={<Clock3 size={20} />} tone="violet" />
    </section>
  );
}
