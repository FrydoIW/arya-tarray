"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { IconButton } from "@/components/ui/IconButton";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { BankAccount, BankAccountStatusFilter } from "../types";
import styles from "../styles/bank-account.module.css";

function formatOpeningBalance(row: BankAccount) {
  if (row.openingBalance == null) return "Not configured";
  return formatCurrency(row.openingBalance, row.currencyCode);
}

type BankAccountTableProps = {
  items: BankAccount[];
  allItems: BankAccount[];
  search: string;
  statusFilter: BankAccountStatusFilter;
  loading: boolean;
  disabled: boolean;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: BankAccountStatusFilter) => void;
  onReload: () => void;
  onAdd: () => void;
  onEdit: (row: BankAccount) => void;
  onRemoveDraft: (id: string) => void;
};

export function BankAccountTable({
  items,
  allItems,
  search,
  statusFilter,
  loading,
  disabled,
  onSearchChange,
  onStatusFilterChange,
  onReload,
  onAdd,
  onEdit,
  onRemoveDraft
}: BankAccountTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    setPage((current) => Math.min(current, pageCount));
  }, [items.length, pageSize]);

  const columns = useMemo<DataTableColumn<BankAccount>[]>(() => [
    {
      key: "bankCode",
      header: "Bank",
      width: "130px",
      minWidth: "120px",
      sticky: "left",
      render: (row) => (
        <div className={styles.bankCell}>
          <strong>{row.bankCode}</strong>
          <small>{row.bankName}</small>
        </div>
      )
    },
    {
      key: "accountNo",
      header: "Account Number",
      width: "190px",
      minWidth: "180px",
      render: (row) => <span className={styles.accountNo}>{row.accountNo}</span>
    },
    {
      key: "accountName",
      header: "Account Name",
      minWidth: "260px"
    },
    {
      key: "currencyCode",
      header: "Currency",
      width: "125px",
      minWidth: "115px"
    },
    {
      key: "openingBalance",
      header: "Opening Balance",
      width: "190px",
      minWidth: "180px",
      render: (row) => (
        <div className={styles.balanceCell}>
          <strong>{formatOpeningBalance(row)}</strong>
          <small>{row.openingBalanceDate ? `As of ${row.openingBalanceDate}` : "No baseline date"}</small>
        </div>
      )
    },
    {
      key: "activeFlag",
      header: "Status",
      width: "150px",
      minWidth: "140px",
      render: (row) => <StatusBadge active={row.activeFlag} activeLabel="Active" inactiveLabel="Inactive" />
    },
    {
      key: "updatedBy",
      header: "Updated By",
      width: "190px",
      minWidth: "180px",
      render: (row) => row.isDraft
        ? <span className={styles.draftLabel}>New draft</span>
        : <span className={styles.updatedBy}>{row.updatedBy?.fullName || "-"}</span>
    },
    {
      key: "updatedAt",
      header: "Updated At",
      width: "190px",
      minWidth: "180px",
      render: (row) => row.isDraft ? <span className={styles.draftLabel}>Not saved</span> : formatDateTime(row.updatedAt)
    },
    {
      key: "actions",
      header: "Action",
      width: "92px",
      minWidth: "92px",
      align: "center",
      sticky: "right",
      render: (row) => (
        <div className={styles.rowActions}>
          <IconButton label={`Edit ${row.bankCode} ${row.accountNo}`} icon={<Pencil size={16} />} disabled={disabled} onClick={() => onEdit(row)} />
          {row.isDraft ? (
            <IconButton label={`Remove draft ${row.accountNo}`} icon={<Trash2 size={16} />} variant="danger" disabled={disabled} onClick={() => onRemoveDraft(row.id)} />
          ) : null}
        </div>
      )
    }
  ], [disabled, onEdit, onRemoveDraft]);

  return (
    <CollapsibleSection
      className={styles.tablePanel}
      title="Bank Account Configuration"
      description="Maintain bank accounts that may be used for statement upload. Persisted Bank and Account Number are stable identities."
      summary={`${allItems.length} accounts`}
      defaultExpanded={false}
      actions={<div className={styles.tableToolbar}>
          <SearchInput
            value={search}
            onChange={(event) => { setPage(1); onSearchChange(event.target.value); }}
            placeholder="Search bank or account..."
            aria-label="Search bank accounts"
          />
          <Select
            value={statusFilter}
            onChange={(event) => { setPage(1); onStatusFilterChange(event.target.value as BankAccountStatusFilter); }}
            aria-label="Filter bank account status"
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
          <Button type="button" variant="outline" size="sm" icon={<RefreshCw size={16} />} onClick={onReload} disabled={loading || disabled} title="Reload database state and discard unsaved changes.">
            Reload
          </Button>
        </div>}
    >

      <DataTable
        rows={items}
        columns={columns}
        rowKey={(row) => row.id}
        loading={loading}
        disabled={disabled}
        minWidth="1540px"
        emptyState={{
          title: "No bank accounts found",
          description: search || statusFilter !== "ALL" ? "Try changing your search or status filter." : "Add the first supported bank account."
        }}
        pagination={{
          page,
          pageSize,
          total: items.length,
          onPageChange: setPage,
          onPageSizeChange: (nextPageSize) => { setPageSize(nextPageSize); setPage(1); }
        }}
        footerActions={(
          <Button type="button" variant="outline" size="sm" icon={<Plus size={16} />} onClick={() => {
            onAdd();
            setPage(Math.max(1, Math.ceil((allItems.length + 1) / pageSize)));
          }} disabled={disabled}>
            Add
          </Button>
        )}
      />
    </CollapsibleSection>
  );
}
