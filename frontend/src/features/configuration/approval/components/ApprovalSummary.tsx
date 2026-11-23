import { ShieldCheck, SlidersHorizontal, UsersRound } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import styles from "../styles/approval.module.css";

type ApprovalSummaryProps = {
  total: number;
  active: number;
  approvers: number;
};

export function ApprovalSummary({ total, active, approvers }: ApprovalSummaryProps) {
  return (
    <section className={styles.metrics}>
      <MetricCard
        label="Total Configurations"
        value={total}
        detail="configured approval processes"
        icon={<SlidersHorizontal size={20} />}
        tone="blue"
      />
      <MetricCard
        label="Active Configurations"
        value={active}
        detail="currently active"
        icon={<ShieldCheck size={20} />}
        tone="green"
      />
      <MetricCard
        label="Total Approvers"
        value={approvers}
        detail="across all configurations"
        icon={<UsersRound size={20} />}
        tone="violet"
      />
    </section>
  );
}
