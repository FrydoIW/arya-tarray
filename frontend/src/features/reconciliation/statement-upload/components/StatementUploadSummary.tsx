import { CheckCircle2, FileSpreadsheet, ListChecks, TriangleAlert } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import type { StatementUploadSummary as Summary } from "../types";
import styles from "../styles/statement-upload.module.css";

type Props = {
  summary: Summary;
};

export function StatementUploadSummary({ summary }: Props) {
  return (
    <div className={styles.metrics}>
      <MetricCard
        label="Draft Statements"
        value={summary.draftStatements.toLocaleString("en-US")}
        detail="active draft statements"
        icon={<FileSpreadsheet size={20} />}
        tone="blue"
      />
      <MetricCard
        label="Total Transactions"
        value={summary.totalTransactions.toLocaleString("en-US")}
        detail="in active drafts"
        icon={<ListChecks size={20} />}
        tone="green"
      />
      <MetricCard
        label="Needs Review"
        value={summary.needsReview.toLocaleString("en-US")}
        detail="eligible transactions need attention"
        icon={<TriangleAlert size={20} />}
        tone="gold"
      />
      <MetricCard
        label="Ready for Submission"
        value={summary.readyForSubmission.toLocaleString("en-US")}
        detail="drafts ready to submit"
        icon={<CheckCircle2 size={20} />}
        tone="violet"
      />
    </div>
  );
}
