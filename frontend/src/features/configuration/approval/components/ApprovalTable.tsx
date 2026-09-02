"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { IconButton } from "@/components/ui/IconButton";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { formatDateTime } from "@/lib/format";
import type { ApprovalConfiguration, ApprovalStatusFilter } from "../types";
import styles from "../styles/approval.module.css";

type ApprovalTableProps = {
  items: ApprovalConfiguration[];
  allItems: ApprovalConfiguration[];
  search: string;
  statusFilter: ApprovalStatusFilter;
  loading: boolean;
  disabled: boolean;
  canAdd: boolean;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: ApprovalStatusFilter) => void;
  onReload: () => void;
  onStatusChange: (id: string, activeFlag: boolean) => void;
  onEdit: (configuration: ApprovalConfiguration) => void;
  onRemoveDraft: (id: string) => void;
  onAdd: () => void;
};

export function ApprovalTable({
  items,
  allItems,
  search,
  statusFilter,
  loading,
  disabled,
  canAdd,
  onSearchChange,
  onStatusFilterChange,
  onReload,
  onStatusChange,
  onEdit,
  onRemoveDraft,
  onAdd
}: ApprovalTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    setPage((current) => Math.min(current, pageCount));
  }, [items.length, pageSize]);

  const columns = useMemo<DataTableColumn<ApprovalConfiguration>[]>(() => [
    {
      key: "menu",
      header: "Process / Menu",
      width: "255px",
      minWidth: "245px",
      sticky: "left",
      render: (row) => (
        <div className={styles.processCell}>
          <strong>{row.menu.menuName}</strong>
        </div>
      )
    },
    {
      key: "approvers",
      header: "Approvers",
      minWidth: "360px",
      render: (row) => (
        <div className={styles.approverChips}>
          {row.approvers.map((approver) => (
            <span
              key={approver.id}
              className={`${styles.approverChip} ${approver.eligible ? "" : styles.ineligible}`}
              title={approver.eligible ? approver.email : `${approver.email} — no longer eligible`}
            >
              <UserRound size={13} />
              <span>{approver.fullName}</span>
              {!approver.eligible ? <small>!</small> : null}
            </span>
          ))}
        </div>
      )
    },
    {
      key: "activeFlag",
      header: "Status",
      width: "165px",
      minWidth: "155px",
      render: (row) => (
        <label className={`${styles.statusSelect} ${row.activeFlag ? styles.active : styles.inactive}`}>
          <span className={styles.statusDot} />
          <select
            value={row.activeFlag ? "true" : "false"}
            disabled={disabled}
            onChange={(event) => onStatusChange(row.id, event.target.value === "true")}
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
      )
    },
    {
      key: "updatedBy",
      header: "Updated By",
      width: "205px",
      minWidth: "190px",
      render: (row) => row.isDraft
        ? <span className={styles.draftLabel}>New draft</span>
        : <span className={styles.updatedBy}>{row.updatedBy?.fullName ?? "—"}</span>
    },
    {
      key: "updatedAt",
      header: "Updated At",
      width: "190px",
      minWidth: "180px",
      render: (row) => row.isDraft
        ? <span className={styles.draftLabel}>Not executed</span>
        : formatDateTime(row.updatedAt)
    },
    {
      key: "action",
      header: "Action",
      width: "90px",
      minWidth: "90px",
      align: "center",
      sticky: "right",
      render: (row) => (
        <div className={styles.rowActions}>
          {row.isDraft ? (
            <>
              <IconButton
                label={`Edit draft ${row.menu.menuName}`}
                icon={<Pencil size={16} />}
                disabled={disabled}
                onClick={() => onEdit(row)}
              />
              <IconButton
                label={`Remove draft ${row.menu.menuName}`}
                icon={<Trash2 size={16} />}
                variant="danger"
                disabled={disabled}
                onClick={() => onRemoveDraft(row.id)}
              />
            </>
          ) : (
            <IconButton
              label={`Edit Approval Configuration for ${row.menu.menuName}`}
              icon={<Pencil size={16} />}
              disabled={disabled}
              onClick={() => onEdit(row)}
            />
          )}
        </div>
      )
    }
  ], [disabled, onEdit, onRemoveDraft, onStatusChange]);

  return (
    <section className={styles.tablePanel}>
      <div className={styles.tableHeader}>
        <div>
          <h2>Approval Configuration</h2>
          <p>Assign approvers for supported processes. Existing Process/Menu identity is read-only after the first Execute.</p>
        </div>

        <div className={styles.tableToolbar}>
          <SearchInput
            value={search}
            onChange={(event) => {
              setPage(1);
              onSearchChange(event.target.value);
            }}
            placeholder="Search process or approver..."
            aria-label="Search approval configuration"
          />
          <Select
            value={statusFilter}
            onChange={(event) => {
              setPage(1);
              onStatusFilterChange(event.target.value as ApprovalStatusFilter);
            }}
            aria-label="Filter approval status"
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<RefreshCw size={16} />}
            onClick={onReload}
            disabled={loading || disabled}
            title="Reload latest Approval workspace from database. Unsaved changes will be discarded."
          >
            Reload
          </Button>
        </div>
      </div>

      <DataTable
        rows={items}
        columns={columns}
        rowKey={(row) => row.id}
        loading={loading}
        disabled={disabled}
        minWidth="1260px"
        emptyState={{
          title: "No approval configuration found",
          description: search || statusFilter !== "ALL"
            ? "Try changing your search or status filter."
            : "Add the Statement Upload approval configuration."
        }}
        pagination={{
          page,
          pageSize,
          total: items.length,
          onPageChange: setPage,
          onPageSizeChange: (nextPageSize) => {
            setPageSize(nextPageSize);
            setPage(1);
          }
        }}
        footerActions={(
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<Plus size={16} />}
            onClick={() => {
              onAdd();
              setPage(Math.max(1, Math.ceil((allItems.length + 1) / pageSize)));
            }}
            disabled={disabled || !canAdd}
            title={canAdd ? "Add Approval Configuration" : "All V1 approval processes are already configured."}
          >
            Add
          </Button>
        )}
      />
    </section>
  );
}
