"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { IconButton } from "@/components/ui/IconButton";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { formatDateTime } from "@/lib/format";
import type { EventCode, EventCodeStatusFilter } from "../types";
import styles from "../styles/event-code.module.css";

type EventCodeTableProps = {
  items: EventCode[];
  search: string;
  statusFilter: EventCodeStatusFilter;
  loading: boolean;
  disabled: boolean;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: EventCodeStatusFilter) => void;
  onReload: () => void;
  onCellChange: (id: string, field: string, value: unknown) => void;
  onDelete: (id: string) => void;
  totalCount: number;
  onAdd: () => void;
};

export function EventCodeTable({
  items,
  search,
  statusFilter,
  loading,
  disabled,
  onSearchChange,
  onStatusFilterChange,
  onReload,
  onCellChange,
  onDelete,
  totalCount,
  onAdd
}: EventCodeTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    setPage((current) => Math.min(current, pageCount));
  }, [items.length, pageSize]);

  const columns = useMemo<DataTableColumn<EventCode>[]>(() => [
    {
      key: "code",
      header: "Event Code",
      width: "150px",
      minWidth: "140px",
      sticky: "left",
      editable: true,
      placeholder: "000"
    },
    {
      key: "eventName",
      header: "Event Name",
      minWidth: "240px",
      editable: true,
      placeholder: "Event name"
    },
    {
      key: "description",
      header: "Description",
      minWidth: "380px",
      editable: true,
      placeholder: "Optional description"
    },
    {
      key: "activeFlag",
      header: "Status",
      width: "160px",
      minWidth: "150px",
      editable: true,
      renderEditor: ({ value, onChange }) => (
        <label className={`${styles.statusSelect} ${Boolean(value) ? styles.active : styles.inactive}`}>
          <span className={styles.statusDot} />
          <select value={Boolean(value) ? "true" : "false"} disabled={disabled} onChange={(event) => onChange(event.target.value === "true")}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
      )
    },
    {
      key: "updatedBy",
      header: "Updated By",
      width: "190px",
      minWidth: "180px",
      render: (row) => row.isDraft
        ? <span className={styles.draftLabel}>New row</span>
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
      width: "82px",
      minWidth: "82px",
      align: "center",
      sticky: "right",
      render: (row) => (
        <div className={styles.rowActions}>
          <IconButton
            label={row.isDraft ? "Remove draft row" : `Delete Event Code ${row.code}`}
            icon={<Trash2 size={16} />}
            variant="danger"
            disabled={disabled}
            onClick={() => onDelete(row.id)}
          />
        </div>
      )
    }
  ], [disabled, onDelete]);

  return (
    <section className={styles.tablePanel}>
      <div className={styles.tableHeader}>
        <div>
          <h2>Event Code Master</h2>
          <p>Edit rows directly. Add, edit, status changes, and delete are only saved after Execute.</p>
        </div>

        <div className={styles.tableToolbar}>
          <SearchInput
            value={search}
            onChange={(event) => {
              setPage(1);
              onSearchChange(event.target.value);
            }}
            placeholder="Search code, event, or updater..."
            aria-label="Search event codes"
          />
          <Select
            value={statusFilter}
            onChange={(event) => {
              setPage(1);
              onStatusFilterChange(event.target.value as EventCodeStatusFilter);
            }}
            aria-label="Filter event code status"
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
            title="Reload latest data from database. Unsaved changes will be discarded."
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
        minWidth="1420px"
        emptyState={{
          title: "No event codes found",
          description: search || statusFilter !== "ALL" ? "Try changing your search or status filter." : "Add the first 3-digit event code."
        }}
        onCellChange={(row, key, value) => onCellChange(row.id, key, value)}
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
          <Button type="button" variant="outline" size="sm" icon={<Plus size={16} />} onClick={() => {
            onAdd();
            setPage(Math.max(1, Math.ceil((totalCount + 1) / pageSize)));
          }} disabled={disabled}>
            Add
          </Button>
        )}
      />
    </section>
  );
}
