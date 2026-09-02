"use client";

import { useMemo } from "react";
import { Eye, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { MonthPicker } from "@/components/ui/MonthPicker";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { formatDate, formatMoney } from "@/lib/format";
import type { TransactionInquiryBankAccount, TransactionInquiryRow, TransactionInquiryStatus } from "../types";
import { eventLabel, formatMonthLabel, getLifecycleLabel } from "../utils/transaction-inquiry.utils";
import styles from "../styles/transaction-inquiry.module.css";

type Props = {
  rows: TransactionInquiryRow[];
  bankAccounts: TransactionInquiryBankAccount[];
  month: string;
  maxMonth: string;
  search: string;
  status: TransactionInquiryStatus;
  bankAccountId: string;
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  detailLoading: boolean;
  onMonthChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: TransactionInquiryStatus) => void;
  onBankAccountChange: (value: string) => void;
  onPageChange: (value: number) => void;
  onPageSizeChange: (value: number) => void;
  onReload: () => void;
  onView: (transactionId: string) => void;
};

function typeOf(row: TransactionInquiryRow) {
  return Number(row.originalAmount) >= 0 ? "Credit" : "Debit";
}

export function TransactionInquiryTable(props: Props) {
  const columns = useMemo<DataTableColumn<TransactionInquiryRow>[]>(() => [
    { key: "transactionDate", header: "Date", minWidth: "110px", sticky: "left", render: (row) => <span className={styles.primaryCell}>{formatDate(row.transactionDate)}</span> },
    { key: "bankAccount", header: "Bank Account", minWidth: "180px", render: (row) => <span className={styles.primaryCell}>{row.bankAccount.bankCode} - {row.bankAccount.accountNo}</span> },
    { key: "description", header: "Description", minWidth: "245px", render: (row) => <div className={styles.descriptionCell}><strong>{row.description || row.senderName || "-"}</strong><small>{row.referenceNo || row.senderName || ""}</small></div> },
    { key: "originalAmount", header: "Amount", minWidth: "130px", align: "right", render: (row) => <span className={`${styles.amountCell} ${Number(row.originalAmount) < 0 ? styles.debitAmount : ""}`}>{formatMoney(Math.abs(Number(row.originalAmount)))}</span> },
    { key: "type", header: "Type", minWidth: "86px", render: (row) => <span className={`${styles.typeBadge} ${typeOf(row) === "Credit" ? styles.credit : styles.debit}`}>{typeOf(row)}</span> },
    { key: "suggestedEvent", header: "Suggested Event", minWidth: "160px", render: (row) => <span className={styles.eventText}>{eventLabel(row.suggestedEvent)}</span> },
    { key: "finalEvent", header: "Final Event", minWidth: "160px", render: (row) => <span className={styles.eventText}>{eventLabel(row.finalEvent)}</span> },
    { key: "status", header: "Status", minWidth: "135px", render: (row) => <span className={`${styles.statusBadge} ${styles[`status${row.status}`]}`}>{getLifecycleLabel(row.status)}</span> },
    { key: "action", header: "Action", minWidth: "90px", sticky: "right", align: "center", render: (row) => <Button type="button" variant="outline" size="sm" icon={<Eye size={13} />} disabled={props.detailLoading} onClick={() => props.onView(row.id)}>View</Button> }
  ], [props.detailLoading, props.onView]);

  return (
    <section className={styles.tablePanel}>
      <div className={styles.tableHeader}>
        <div><h2>Transaction Inquiry</h2><p>Search and review reconciliation transactions in {formatMonthLabel(props.month)}.</p></div>
        <div className={styles.toolbar}>
          <MonthPicker className={styles.monthFilter} value={props.month} maxMonth={props.maxMonth} disabled={props.loading} ariaLabel="Transaction Inquiry month" onChange={props.onMonthChange} />
          <SearchInput className={styles.searchFilter} value={props.search} disabled={props.loading} placeholder="Search description or reference" onChange={(event) => props.onSearchChange(event.target.value)} />
          <Select className={styles.statusFilter} value={props.status} disabled={props.loading} onChange={(event) => props.onStatusChange(event.target.value as TransactionInquiryStatus)} aria-label="Transaction status">
            <option value="ALL">All Status</option><option value="RAW">Draft</option><option value="CHECK">Pending Approval</option><option value="FINALIZED">Complete</option>
          </Select>
          <Select className={styles.bankFilter} value={props.bankAccountId} disabled={props.loading} onChange={(event) => props.onBankAccountChange(event.target.value)} aria-label="Bank account">
            <option value="ALL">All Bank Accounts</option>
            {props.bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.bankCode} - {account.accountNo}</option>)}
          </Select>
          <Button className={styles.reloadButton} type="button" variant="secondary" size="sm" icon={<RotateCw size={14} className={props.loading ? "spin" : ""} />} disabled={props.loading} onClick={props.onReload}>Reload</Button>
        </div>
      </div>
      <DataTable
        rows={props.rows}
        columns={columns}
        rowKey={(row) => row.id}
        loading={props.loading}
        minWidth="1300px"
        emptyState={{ title: `No transactions in ${formatMonthLabel(props.month)}`, description: "Choose another month or adjust the search and filters." }}
        pagination={{ mode: "server", page: props.page, pageSize: props.pageSize, total: props.total, pageSizeOptions: [10, 25, 50, 100], onPageChange: props.onPageChange, onPageSizeChange: props.onPageSizeChange }}
      />
    </section>
  );
}
