import { ShieldCheck, UserRoundCheck, UserRoundX, UsersRound } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import styles from "../styles/user.module.css";

type UserSummaryProps = {
  total: number;
  active: number;
  inactive: number;
  assignedRoleCount: number;
  totalRoleCount: number;
};

export function UserSummary({
  total,
  active,
  inactive,
  assignedRoleCount,
  totalRoleCount
}: UserSummaryProps) {
  return (
    <section className={styles.metrics}>
      <MetricCard
        label="Total Users"
        value={total}
        detail="registered system users"
        tone="blue"
        icon={<UsersRound size={21} />}
      />
      <MetricCard
        label="Active Users"
        value={active}
        detail="currently active users"
        tone="green"
        icon={<UserRoundCheck size={21} />}
      />
      <MetricCard
        label="Inactive Users"
        value={inactive}
        detail="inactive user accounts"
        tone="red"
        icon={<UserRoundX size={21} />}
      />
      <MetricCard
        label="Role Coverage"
        value={`${assignedRoleCount}/${totalRoleCount}`}
        detail="roles currently assigned to users"
        tone="violet"
        icon={<ShieldCheck size={21} />}
      />
    </section>
  );
}
