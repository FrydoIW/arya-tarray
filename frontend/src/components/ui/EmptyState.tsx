import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

type EmptyStateProps = {
  title?: string;
  description?: string;
  icon?: ReactNode;
};

export function EmptyState({ title = "No data available", description, icon }: EmptyStateProps) {
  return (
    <div className="ui-empty-state">
      <span aria-hidden="true">{icon ?? <Inbox size={20} />}</span>
      <strong>{title}</strong>
      {description ? <small>{description}</small> : null}
    </div>
  );
}
