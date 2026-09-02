import { CheckCircle2, FileCheck2, Hourglass, XCircle } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import type { SignApprovalWorkspace } from "../types";
import styles from "../styles/sign-approval.module.css";

type SignApprovalSummaryProps = {
  summary: SignApprovalWorkspace["summary"];
};

export function SignApprovalSummary({ summary }: SignApprovalSummaryProps) {
  return (
    <section className={styles.metrics}>
      <MetricCard
        label="Pending Approval"
        value={summary.pendingApproval}
        detail="statements awaiting decision"
        icon={<Hourglass size={20} />}
        tone="blue"
      />
      <MetricCard
        label="Approved Today"
        value={summary.approvedToday}
        detail="statements approved today"
        icon={<CheckCircle2 size={20} />}
        tone="green"
      />
      <MetricCard
        label="Rejected Today"
        value={summary.rejectedToday}
        detail="statements returned today"
        icon={<XCircle size={20} />}
        tone="red"
      />
      <MetricCard
        label="Total Decided"
        value={summary.totalDecided}
        detail="approved and rejected requests"
        icon={<FileCheck2 size={20} />}
        tone="violet"
      />
    </section>
  );
}
