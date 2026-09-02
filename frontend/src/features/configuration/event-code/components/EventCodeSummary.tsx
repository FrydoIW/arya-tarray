import { CircleOff, Search, Tags, ToggleRight } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import styles from "../styles/event-code.module.css";

type EventCodeSummaryProps = {
  total: number;
  active: number;
  inactive: number;
};

export function EventCodeSummary({ total, active, inactive }: EventCodeSummaryProps) {
  return (
    <section className={styles.metrics}>
      <MetricCard label="Total Event Codes" value={total} detail="registered 3-digit codes" icon={<Tags size={20} />} tone="blue" />
      <MetricCard label="Active Codes" value={active} detail="available for auto matching" icon={<ToggleRight size={20} />} tone="green" />
      <MetricCard label="Inactive Codes" value={inactive} detail="kept for historical reference" icon={<CircleOff size={20} />} tone="red" />
      <MetricCard label="Matching Rule" value="3 digits" detail="read from the amount suffix" icon={<Search size={20} />} tone="violet" />
    </section>
  );
}
