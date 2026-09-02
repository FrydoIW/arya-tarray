import { BadgeCheck, Building2, CirclePause, Landmark } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import styles from "../styles/bank-account.module.css";

type BankAccountSummaryProps = {
  total: number;
  active: number;
  inactive: number;
  supportedBanks: string;
};

export function BankAccountSummary({ total, active, inactive, supportedBanks }: BankAccountSummaryProps) {
  return (
    <section className={styles.metrics}>
      <MetricCard label="Total Accounts" value={total} detail="registered bank accounts" icon={<Landmark size={21} />} tone="blue" />
      <MetricCard label="Active Accounts" value={active} detail="currently available" icon={<BadgeCheck size={21} />} tone="green" />
      <MetricCard label="Inactive Accounts" value={inactive} detail="temporarily disabled" icon={<CirclePause size={21} />} tone="gold" />
      <MetricCard label="Supported Banks" value={supportedBanks} detail="current parser-ready bank" icon={<Building2 size={21} />} tone="violet" />
    </section>
  );
}
