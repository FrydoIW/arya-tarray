"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import styles from "./AccountingWorkspace.module.css";

export function AccountingWorkspaceNavigation() {
  const pathname = usePathname();
  return <nav className={styles.navigation} aria-label="Accounting workspace">
    {[
      ["/accounting", "Overview"], ["/accounting/coa", "Chart of Accounts"], ["/accounting/journals", "Journals"],
      ["/accounting/approvals", "Approval"], ["/accounting/general-ledger", "General Ledger"], ["/accounting/trial-balance", "Trial Balance"],
      ["/accounting/periods", "Fiscal Periods"], ["/accounting/payables", "Payables"], ["/accounting/receivables", "Receivables"],
      ["/accounting/accruals", "Accruals"], ["/accounting/schedules", "Schedules"],
      ["/accounting/assets", "Fixed Assets"],
      ["/accounting/funds", "Fund Accounting"],
      ["/accounting/financial-reports", "Financial Statements"],
      ["/accounting/reconciliation", "Reconciliation"],
      ["/accounting/closing", "Closing"],
      ["/accounting/reports", "Existing Reports"]
    ].map(([href, label]) =>
      <Link key={href} href={href} className={styles.navLink}
        aria-current={pathname === href || (href !== "/accounting" && pathname.startsWith(href + "/")) ? "page" : undefined}>{label}</Link>)}
  </nav>;
}
export function AccountingStatusIndicator({ status }: { status: string }) {
  const tone = ["VERIFIED", "APPROVED", "POSTED", "RECONCILED", "PASS", "BALANCED", "READY", "APPLIED", "NOT_APPLICABLE"].includes(status) ? "success"
    : ["PENDING_POLICY", "PENDING_INDEPENDENT_REVIEW", "REVIEW_REQUIRED", "UNVERIFIED", "NOT_READY", "CLOSING", "PENDING", "AWAITING_STATEMENT",
      "DRAFT_RESERVED", "MATCHED_PENDING_FINALIZATION", "BANK_REVIEW_REQUIRED", "MISMATCH", "FAIL", "WARNING", "PENDING_REVIEW", "ERROR"].includes(status) ? "warning" : "neutral";
  return <span className={styles.status} data-tone={tone}><StatusBadge active={tone === "success"} activeLabel={status} inactiveLabel={status} /></span>;
}
export function AccountingDataState({ loading, error, forbidden, onRetry }: { loading: boolean; error: string; forbidden: boolean; onRetry: () => void }) {
  if (loading) return <p role="status" className={styles.note}>Loading Accounting data…</p>;
  if (forbidden) return <div role="alert"><EmptyState title="Additional access required" description="You do not have permission to view this information. Report access does not grant manage, approve or post permissions." /></div>;
  if (error) return <div className={styles.error} role="alert"><p>{error}</p><Button variant="outline" size="sm" onClick={onRetry}>Retry</Button></div>;
  return null;
}
