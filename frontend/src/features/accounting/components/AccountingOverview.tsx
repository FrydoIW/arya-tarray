"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, BookOpen, Boxes, CalendarDays, CheckCheck, ClipboardCheck, Clock3, FileBarChart2, HandCoins, Landmark, LayoutGrid, ListTree, PieChart, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAuthSession } from "@/features/auth/context/AuthSessionContext";
import { currentBusinessDayValue } from "@/lib/business-time";
import { getAccountingAccountSummary, getAccountingFiscalYears, getAccountingPendingApprovals } from "../api/accounting.api";
import { useAccountingRead } from "../hooks/useAccountingRead";
import { AccountingDataState, AccountingStatusIndicator, AccountingWorkspaceNavigation } from "./AccountingFoundation";
import styles from "./AccountingWorkspace.module.css";
import { journalPermissions } from "../core/contracts.generated";

const modules = [
  { title: "Overview", description: "Fiscal context, account catalog and your pending approval summary.", icon: LayoutGrid, href: "/accounting" },
  { title: "Chart of Accounts & Ledger", description: "Account management and the full General Ledger workspace.", icon: ListTree, href: "/accounting/coa" },
  { title: "Journals & Approval", description: "Journal preparation, independent review and posting workflows.", icon: ClipboardCheck, href: "/accounting/journals" },
  { title: "Accounts Payable & Receivable", description: "Invoices, receivables, payments and receipt allocations.", icon: HandCoins, href: "/accounting/payables" },
  { title: "Accruals & Prepayments", description: "Accrual recognition, prepayments and amortization schedules.", icon: Clock3, href: "/accounting/accruals" },
  { title: "Fixed Assets", description: "Asset register, depreciation and disposal workflows.", icon: Boxes, href: "/accounting/assets" },
  { title: "Fund Accounting", description: "Funds, donor restrictions and reviewed restriction releases.", icon: Landmark, href: "/accounting/funds" },
  { title: "Financial Statements", description: "Posted-GL position, income, net assets, cash flows, policy readiness and supporting evidence.", icon: PieChart, href: "/accounting/financial-reports" },
  { title: "Reconciliation & Closing", description: "Bank and subledger review, period closing and reopening.", icon: CheckCheck, href: "/accounting/reconciliation" },
  { title: "Donation Reports", description: "Open existing donation reports, journal evidence and PDF/Excel exports.", icon: FileBarChart2, href: "/accounting/reports" }
];
const approvalPermissions = [...Object.values(journalPermissions), "ACCOUNTING_AP_MANAGE", "ACCOUNTING_AR_MANAGE"];
const inDateRange = (today: string, start: string, end: string) => start.slice(0, 10) <= today && today <= end.slice(0, 10);

export function AccountingOverview() {
  const user = useAuthSession(), canReport = user.menuCodes.includes("ACCOUNTING_REPORT"), canReadApprovals = approvalPermissions.some(code => user.menuCodes.includes(code));
  const years = useAccountingRead(`accounting:${user.id}:fiscal-years`, getAccountingFiscalYears, canReport);
  const accounts = useAccountingRead(`accounting:${user.id}:coa-summary`, getAccountingAccountSummary, canReport);
  const approvals = useAccountingRead(`accounting:${user.id}:pending-approvals`, getAccountingPendingApprovals, canReport && canReadApprovals);
  const [yearId, setYearId] = useState<string | null>(null), [periodId, setPeriodId] = useState<string | null>(null);
  const today = currentBusinessDayValue(), fiscalYears = years.data ?? [];
  const currentYear = fiscalYears.find(year => inDateRange(today, year.startDate, year.endDate));
  const year = fiscalYears.find(item => item.id === (yearId ?? currentYear?.id));
  const periods = year?.revFkAccPeriodFy ?? [], currentPeriod = periods.find(period => inDateRange(today, period.startDate, period.endDate));
  const period = periods.find(item => item.id === (periodId ?? currentPeriod?.id));
  const reportHref = (view: string) => `/accounting/${view === "ledger" ? "general-ledger" : "trial-balance"}?${new URLSearchParams({ ...(period ? { from: period.startDate.slice(0, 10), to: period.endDate.slice(0, 10), accountingPeriodId: period.id, fiscalYearId: year?.id ?? "" } : {}) })}`;
  const refreshing = years.loading || accounts.loading || approvals.loading;
  return <div className={styles.page}>
    <PageHeader breadcrumb={["Accounting", "Overview"]} title="Accounting" description="Full Accrual Accounting & Financial Management."
      actions={<Button variant="outline" icon={<RefreshCw size={15} />} disabled={refreshing} onClick={() => { years.refresh(); accounts.refresh(); if (canReadApprovals) approvals.refresh(); }}>{refreshing ? "Refreshing…" : "Refresh"}</Button>} />
    <AccountingWorkspaceNavigation />
    <div className={styles.summary}>
      <Card className={styles.panel} aria-busy={years.loading}>
        <h2>Fiscal year</h2><AccountingDataState {...years} onRetry={years.refresh} />
        {years.data ? fiscalYears.length ? <>
          <div className={styles.field}><label htmlFor="accounting-fiscal-year">Select fiscal year</label><Select id="accounting-fiscal-year" aria-label="Select fiscal year" value={year?.id ?? ""} disabled={years.loading} onChange={event => { setYearId(event.target.value); setPeriodId(null); }}>
            <option value="">Select fiscal year</option>{fiscalYears.map(item => <option key={item.id} value={item.id}>{item.yearCode}</option>)}
          </Select></div>
          {year ? <div className={styles.periodLine}><AccountingStatusIndicator status={year.status} /><span className={styles.note}>{year.startDate.slice(0, 10)} – {year.endDate.slice(0, 10)}</span></div> : <p className={styles.note}>No fiscal year selected. Choose an available year.</p>}
        </> : <EmptyState title="No fiscal year available" description="No fiscal year has been made available for reporting." /> : null}
      </Card>
      <Card className={styles.panel} aria-busy={accounts.loading}><h2>Chart of Accounts</h2><AccountingDataState {...accounts} onRetry={accounts.refresh} />
        {accounts.data ? <><strong className={styles.value}>{accounts.data.total.toLocaleString("en-GB")}</strong><p className={styles.note}>Accounts in the catalog, including inactive and header accounts. This count does not confirm COA completeness or reporting mappings.</p></> : null}
      </Card>
      <Card className={styles.panel} aria-busy={approvals.loading}><h2>Your pending approvals</h2>
        {canReadApprovals ? <><AccountingDataState {...approvals} onRetry={approvals.refresh} />{approvals.data ? <><strong className={styles.value}>{approvals.data.total.toLocaleString("en-GB")}</strong><p className={styles.note}>Requests you submitted or are assigned to review. This is not the global queue or an authority to approve/post.</p></> : null}</>
          : <EmptyState title="Additional Accounting access required" description="Report access does not include the Accounting approval queue. No pending count is available for your current permissions." />}
      </Card>
    </div>
    <div className={styles.context}>
      <Card className={styles.panel}><h2>Accounting period</h2>
        {years.loading && !years.data ? <p role="status" className={styles.note}>Loading fiscal context…</p> : years.error ? <p className={styles.note}>Period context is unavailable until fiscal information can be loaded.</p> : !year ? <EmptyState title="Select a fiscal year" description="Choose a year to see its available accounting periods." /> : !periods.length ? <EmptyState title="No periods available" description="No accounting periods are available for this fiscal year." /> : <>
          <div className={styles.field}><label htmlFor="accounting-period">Select accounting period</label><Select id="accounting-period" aria-label="Select accounting period" value={period?.id ?? ""} disabled={years.loading} onChange={event => setPeriodId(event.target.value)}>
            <option value="">Select accounting period</option>{periods.map(item => <option key={item.id} value={item.id}>{item.periodCode}</option>)}
          </Select></div>
          {period ? <div className={styles.periodLine}><CalendarDays size={16} aria-hidden="true" /><span className={styles.note}>{period.startDate.slice(0, 10)} – {period.endDate.slice(0, 10)}</span><AccountingStatusIndicator status={period.status} /></div> : <p className={styles.note}>No period selected. Choose one of this fiscal year’s available periods.</p>}
        </>}
        <div className={styles.quickLinks}><Link className={styles.link} href={reportHref("ledger")}><BookOpen size={15} aria-hidden="true" />General Ledger</Link><Link className={styles.link} href={reportHref("trial")}><FileBarChart2 size={15} aria-hidden="true" />Trial Balance</Link></div>
        <p className={styles.note}>Read posted Accounting journals using the selected period dates. Existing donation reports remain available separately.</p>
      </Card>
      <Card className={styles.panel}><h2>Policy & reporting readiness</h2><AccountingStatusIndicator status="NOT_EVALUATED" />
        <p className={styles.note}>Financial readiness has not been assessed here. Reports may require further review before official use.</p>
        <p className={styles.note}>Official use requires approved policy, account mappings, opening evidence and reconciled closing. Viewing a report or an OPEN period does not establish that these requirements are met.</p>
        <Link className={styles.link} href="/accounting/reports">Open existing Accounting Reports<ArrowUpRight size={15} aria-hidden="true" /></Link>
      </Card>
    </div>
    <section aria-labelledby="accounting-modules-heading"><h2 id="accounting-modules-heading" className={styles.sectionTitle}>Accounting modules</h2><p className={styles.sectionIntro}>Source-backed transaction, reconciliation and closing workspaces use the existing Accounting shell.</p>
      <div className={styles.modules}>{modules.map(({ title, description, icon: Icon, ...item }) => {
        const href = "href" in item ? item.href : undefined;
        return <Card key={title} className={styles.module}><div className={styles.moduleHeader}><span className={styles.moduleIcon}><Icon size={18} aria-hidden="true" /></span>{href ? null : <span className={styles.soon}>COMING SOON</span>}</div><h3>{title}</h3><p>{description}</p>
          {href ? <Link href={href}>{href === "/accounting" ? "Current workspace" : href === "/accounting/reports" ? "Open existing reports" : "Open workspace"}<ArrowUpRight size={14} aria-hidden="true" /></Link> : null}</Card>;
      })}</div>
    </section>
  </div>;
}
