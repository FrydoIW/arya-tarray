"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { useTransactionInquiry } from "../hooks/useTransactionInquiry";
import { GenerateReportModal } from "./GenerateReportModal";
import { TransactionDetailModal } from "./TransactionDetailModal";
import { TransactionInquirySummary } from "./TransactionInquirySummary";
import { TransactionInquiryTable } from "./TransactionInquiryTable";
import styles from "../styles/transaction-inquiry.module.css";

export function TransactionInquiryScreen() {
  const inquiry = useTransactionInquiry();
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <div className={`${styles.page} page-stack`}>
      <PageHeader
        breadcrumb={["Reconciliation", "Transaction Inquiry"]}
        title="Transaction Inquiry"
        description="Search and review reconciliation transactions, then generate a financial PDF report."
        actions={<Button type="button" icon={<FileDown size={16} />} disabled={inquiry.loading || inquiry.workspace.summary.totalTransactions === 0} onClick={() => setReportOpen(true)}>Generate Report</Button>}
      />
      {inquiry.error ? <div className="ui-alert ui-alert-error">{inquiry.error}</div> : null}
      <TransactionInquirySummary summary={inquiry.workspace.summary} periodMode={inquiry.period.mode} month={inquiry.period.month} date={inquiry.period.date} />
      <TransactionInquiryTable
        rows={inquiry.workspace.transactions}
        bankAccounts={inquiry.workspace.bankAccounts}
        periodMode={inquiry.period.mode}
        month={inquiry.period.month}
        date={inquiry.period.date}
        maxMonth={inquiry.maxMonth}
        maxDate={inquiry.maxDate}
        search={inquiry.searchInput}
        status={inquiry.status}
        bankAccountId={inquiry.bankAccountId}
        finalEventId={inquiry.finalEventId}
        eventOptions={inquiry.workspace.eventOptions}
        page={inquiry.page}
        pageSize={inquiry.pageSize}
        total={inquiry.workspace.pagination.total}
        loading={inquiry.loading}
        detailLoading={inquiry.detailLoading}
        onPeriodChange={inquiry.changePeriod}
        onSearchChange={inquiry.setSearchInput}
        onStatusChange={inquiry.changeStatus}
        onBankAccountChange={inquiry.changeBankAccount}
        onFinalEventChange={inquiry.changeFinalEvent}
        onPageChange={inquiry.setPage}
        onPageSizeChange={inquiry.changePageSize}
        onReload={() => void inquiry.refresh()}
        onView={(id) => void inquiry.openDetail(id)}
      />
      <div className={styles.infoNote}><strong>Report information</strong><span>PDF reports use the active Period, Search, Status, Bank Account, and Final Event filters and always query the full filtered dataset, not only the visible table page.</span></div>
      <TransactionDetailModal detail={inquiry.detail} open={Boolean(inquiry.detail)} onClose={inquiry.closeDetail} />
      <GenerateReportModal
        open={reportOpen}
        period={inquiry.period}
        search={inquiry.activeSearch}
        status={inquiry.status}
        bankAccountId={inquiry.bankAccountId}
        finalEventId={inquiry.finalEventId}
        bankAccounts={inquiry.workspace.bankAccounts}
        eventOptions={inquiry.workspace.eventOptions}
        loading={inquiry.reportLoading}
        onClose={() => setReportOpen(false)}
        onGenerate={inquiry.generateReport}
      />
    </div>
  );
}
