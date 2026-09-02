import type { ReactNode } from "react";

type MetricCardProps = {
  label: string;
  value: ReactNode;
  detail: string;
  icon: ReactNode;
  tone?: "blue" | "green" | "red" | "violet" | "gold" | "maroon";
};

export function MetricCard({ label, value, detail, icon, tone = "blue" }: MetricCardProps) {
  return (
    <article className="ui-metric-card">
      <span className={`ui-metric-icon ui-tone-${tone}`}>{icon}</span>
      <div className="ui-metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}
