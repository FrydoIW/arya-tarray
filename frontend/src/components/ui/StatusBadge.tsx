type StatusBadgeProps = {
  active: boolean;
  activeLabel?: string;
  inactiveLabel?: string;
};

export function StatusBadge({ active, activeLabel = "ACTIVE", inactiveLabel = "INACTIVE" }: StatusBadgeProps) {
  return (
    <span className={`ui-status-badge ${active ? "is-active" : "is-inactive"}`}>
      <i aria-hidden="true" />
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}
