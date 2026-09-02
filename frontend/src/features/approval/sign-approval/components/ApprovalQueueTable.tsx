"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Eye, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { formatDateTime, formatMoney } from "@/lib/format";
import type {
  SignApprovalQueueItem,
  SignApprovalStatusFilter
} from "../types";
import {
  approvalStatusLabel,
  approvalStatusTone,
  formatStatementPeriod
} from "../utils/sign-approval.utils";
import styles from "../styles/sign-approval.module.css";

type ApprovalQueueTableProps = {
  items: SignApprovalQueueItem[];
  search: string;
  statusFilter: SignApprovalStatusFilter;
  loading: boolean;
  disabled: boolean;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: SignApprovalStatusFilter) => void;
  onReload: () => void;
  onReview: (approvalId: string) => void;
};

function ApprovalState({ status }: { status: string }) {
  return (
    <span className={`${styles.statusBadge} ${styles[approvalStatusTone(status)]}`}>
      <i aria-hidden="true" />
      {approvalStatusLabel(status)}
    </span>
  );
}

export function ApprovalQueueTable({
  items,
  search,
  statusFilter,
  loading,
  disabled,
  onSearchChange,
  onStatusFilterChange,
  onReload,
  onReview
}: ApprovalQueueTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    setPage((value) => Math.min(value, pageCount));
  }, [items.length, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const columns = useMemo<DataTableColumn<SignApprovalQueueItem>[]>(() => [
    {
      key: "statement",
      header: "Statement",
      minWidth: "190px",
      sticky: "left",
      render: (row) => <span className={styles.statementId}>{row.statement.id}</span>
    },
    {
      key: "bankAccount",
      header: "Bank Account",
      minWidth: "180px",
      render: (row) => (
        <div className={styles.bankCell}>
          <strong>{row.statement.bankAccount.bankName}</strong>
          <small>{row.statement.bankAccount.accountNo}</small>
        </div>
      )
    },
    {
      key: "period",
      header: "Period",
      minWidth: "130px",
      render: (row) => formatStatementPeriod(row.statement.periodFrom, row.statement.periodTo)
    },
    {
      key: "transactions",
      header: "Transactions",
      width: "110px",
      align: "center",
      render: (row) => row.statement.totalTransaction.toLocaleString("id-ID")
    },
    {
      key: "amount",
      header: "Total Amount",
      minWidth: "150px",
      align: "right",
      render: (row) => <strong className={styles.amountCell}>{formatMoney(row.statement.totalAmount)}</strong>
    },
    {
      key: "uploadedBy",
      header: "Uploaded By",
      minWidth: "165px",
      render: (row) => row.statement.uploadedBy.fullName
    },
    {
      key: "submittedAt",
      header: "Submitted At",
      minWidth: "165px",
      render: (row) => formatDateTime(row.submittedAt)
    },
    {
      key: "status",
      header: "Status",
      width: "120px",
      render: (row) => <ApprovalState status={row.status} />
    },
    {
      key: "action",
      header: "Action",
      width: "110px",
      align: "center",
      sticky: "right",
      render: (row) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          icon={<Eye size={14} />}
          disabled={disabled}
          onClick={() => onReview(row.approvalId)}
        >
          Review
        </Button>
      )
    }
  ], [disabled, onReview]);

  return (
    <section className={styles.tablePanel}>
      <div className={styles.tableHeader}>
        <div>
          <h2>Approval Queue</h2>
          <p>Statement approval requests available to you under the active approval configuration.</p>
        </div>
        <div className={styles.tableToolbar}>
          <SearchInput
            value={search}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onSearchChange(event.target.value)}
            placeholder="Search statement / bank account"
            aria-label="Search approval queue"
          />
          <Select
            value={statusFilter}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => onStatusFilterChange(event.target.value as SignApprovalStatusFilter)}
            aria-label="Approval status filter"
          >
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="ALL">All Status</option>
          </Select>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} />}
            disabled={disabled}
            onClick={onReload}
          >
            Reload
          </Button>
        </div>
      </div>

      <DataTable
        rows={items}
        columns={columns}
        rowKey={(row: SignApprovalQueueItem) => row.approvalId}
        loading={loading}
        loadingText="Loading approval queue…"
        emptyState={{
          title: statusFilter === "PENDING" ? "No pending approvals" : "No approval requests found",
          description: "Only requests available to your current configured approver access are shown here."
        }}
        minWidth="1320px"
        pagination={{
          page,
          pageSize,
          total: items.length,
          onPageChange: setPage,
          onPageSizeChange: (value: number) => {
            setPage(1);
            setPageSize(value);
          }
        }}
      />
    </section>
  );
}
