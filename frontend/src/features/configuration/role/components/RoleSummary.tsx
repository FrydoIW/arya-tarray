import { CircleOff, ShieldCheck, UserRoundCheck, UsersRound } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import styles from "../styles/role.module.css";

type RoleSummaryProps = {
  total: number;
  active: number;
  inactive: number;
  assignments: number;
};

export function RoleSummary({ total, active, inactive, assignments }: RoleSummaryProps) {
  return (
    <section className={styles.metrics}>
      <MetricCard label="Total Roles" value={total} detail="registered system roles" icon={<UsersRound size={20} />} tone="blue" />
      <MetricCard label="Active Roles" value={active} detail="available for user assignment" icon={<ShieldCheck size={20} />} tone="green" />
      <MetricCard label="Inactive Roles" value={inactive} detail="kept for historical reference" icon={<CircleOff size={20} />} tone="red" />
      <MetricCard label="User Assignments" value={assignments} detail="role assignments across users" icon={<UserRoundCheck size={20} />} tone="violet" />
    </section>
  );
}
