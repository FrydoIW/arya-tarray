"use client";

import { useMemo } from "react";
import { Pencil, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { PeriodPicker } from "@/components/ui/PeriodPicker";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { formatDate, formatMoney } from "@/lib/format";
import type { EditIncomeBankAccount, EditIncomePeriodMode, EditIncomeStatement, EditIncomeStatusFilter } from "../types";
import { getStatementStatusLabel, periodContext } from "../utils/edit-income.utils";
import styles from "../styles/edit-income.module.css";

type Props = {
  rows: EditIncomeStatement[];
  bankAccounts: EditIncomeBankAccount[];
  periodMode: EditIncomePeriodMode;
  month: string;
  date: string;
  maxMonth: string;
  maxDate: string;
  monthDisabled: boolean;
  search: string;
  statusFilter: EditIncomeStatusFilter;
  bankAccountFilter: string;
  page: number;
  pageSize: number;
  loading: boolean;
  busy: boolean;
  onPeriodChange: (value: { mode: EditIncomePeriodMode; month: string; date: string }) => void;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: EditIncomeStatusFilter) => void;
  onBankAccountFilterChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onReload: () => void;
  onEdit: (statementId: string) => void;
};

export function EditIncomeStatementTable(props: Props) {
  const columns = useMemo<DataTableColumn<EditIncomeStatement>[]>(() => [
    {
      key: "periodTo",
      header: "Statement Date",
      minWidth: "120px",
      sticky: "left",
      render: (row) => <span className={styles.dateCell}>{row.periodTo ? formatDate(row.periodTo) : "-"}</span>
    },
    {
      key: "bankAccount",
      header: "Bank Account",
      minWidth: "190px",
      render: (row) => <span className={styles.primaryCell}>{row.bankAccount.bankCode} - {row.bankAccount.accountNo}</span>
    },
    {
      key: "id",
      header: "Statement ID",
      minWidth: "215px",
      render: (row) => <span className={styles.monospace}>{row.id}</span>
    },
    {
      key: "period",
      header: "Period",
      minWidth: "190px",
      render: (row) => <span className={styles.primaryCell}>{row.periodFrom ? formatDate(row.periodFrom) : "-"} - {row.periodTo ? formatDate(row.periodTo) : "-"}</span>
    },
    {
      key: "totalTransaction",
      header: "Transactions",
      minWidth: "110px",
      align: "right"
    },
    {
      key: "totalAmount",
      header: "Total Amount",
      minWidth: "145px",
      align: "right",
      render: (row) => <span className={styles.amountCell}>{formatMoney(row.totalAmount)}</span>
    },
    {
      key: "status",
      header: "Status",
      minWidth: "145px",
      render: (row) => (
        <span className={`${styles.statementStatus} ${row.displayStatus === "COMPLETE" ? styles.complete : styles.pending}`}>
          {getStatementStatusLabel(row.displayStatus)}
        </span>
      )
    },
    {
      key: "action",
      header: "Action",
      minWidth: "110px",
      sticky: "right",
      align: "center",
      render: (row) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          icon={<Pencil size={13} />}
          disabled={!row.editable || props.busy}
          onClick={() => props.onEdit(row.id)}
        >
          {row.editable ? "Edit" : "Pending"}
        </Button>
      )
    }
  ], [props.busy, props.onEdit]);

  const context = periodContext(props.periodMode, props.month, props.date);

  return (
    <CollapsibleSection
      className={styles.tablePanel}
      title="Edit Income Workspace"
      description={`Showing approved statements available ${context}.`}
      summary={`${props.rows.length} statements`}
      defaultExpanded={false}
      actions={<div className={styles.tableToolbar}>
          <PeriodPicker
            className={styles.periodFilter}
            value={{ mode: props.periodMode, month: props.month, date: props.date }}
            maxMonth={props.maxMonth}
            maxDate={props.maxDate}
            disabled={props.loading || props.monthDisabled}
            ariaLabel="Edit Income period"
            onChange={props.onPeriodChange}
          />
          <SearchInput className={styles.searchFilter} value={props.search} disabled={props.loading} placeholder="Search statement or account" onChange={(event) => props.onSearchChange(event.target.value)} />
          <Select className={styles.statusFilter} value={props.statusFilter} disabled={props.loading} onChange={(event) => props.onStatusFilterChange(event.target.value as EditIncomeStatusFilter)} aria-label="Statement status">
            <option value="ALL">All Status</option>
            <option value="COMPLETE">Complete</option>
            <option value="PENDING_REAPPROVAL">Pending Re-approval</option>
          </Select>
          <Select className={styles.bankFilter} value={props.bankAccountFilter} disabled={props.loading} onChange={(event) => props.onBankAccountFilterChange(event.target.value)} aria-label="Bank account">
            <option value="ALL">All Bank Accounts</option>
            {props.bankAccounts.map((account) => <option value={account.id} key={account.id}>{account.bankCode} - {account.accountNo}</option>)}
          </Select>
          <Button className={styles.reloadButton} type="button" variant="secondary" size="sm" icon={<RotateCw size={14} className={props.loading ? "spin" : ""} />} disabled={props.loading || props.busy} onClick={props.onReload}>Reload</Button>
        </div>}
    >
      <DataTable
        rows={props.rows}
        columns={columns}
        rowKey={(row) => row.id}
        loading={props.loading}
        minWidth="1240px"
        emptyState={{ title: `No statements ${context}`, description: "Choose another period or adjust the search and filters." }}
        pagination={{
          page: props.page,
          pageSize: props.pageSize,
          total: props.rows.length,
          pageSizeOptions: [10, 25, 50],
          onPageChange: props.onPageChange,
          onPageSizeChange: props.onPageSizeChange
        }}
      />
    </CollapsibleSection>
  );
}
