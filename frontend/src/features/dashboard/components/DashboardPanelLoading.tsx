import { LoaderCircle } from "lucide-react";

export function DashboardPanelLoading({ label }: { label: string }) {
  return (
    <div className="dashboard-loading-panel" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={20} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
