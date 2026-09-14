"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Eye, PencilLine, Plus, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { IconButton } from "@/components/ui/IconButton";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { formatDateTime } from "@/lib/format";
import type { EventCode, EventCodeMode, EventCodeStatusFilter } from "../types";
import styles from "../styles/event-code.module.css";

type EventCodeTableProps = {
  items: EventCode[];
  search: string;
  statusFilter: EventCodeStatusFilter;
  mode: EventCodeMode;
  loading: boolean;
  disabled: boolean;
  templateDownloading: boolean;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: EventCodeStatusFilter) => void;
  onModeChange: (mode: EventCodeMode) => void;
  onDownloadTemplate: () => void;
  onBulkUpload: () => void;
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
  mode,
  loading,
  disabled,
  templateDownloading,
  onSearchChange,
  onStatusFilterChange,
  onModeChange,
  onDownloadTemplate,
  onBulkUpload,
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
      editable: mode === "EDIT",
      render: (row) => <span className={styles.eventCodeText}>{row.code}</span>,
      placeholder: "000"
    },
    {
      key: "eventName",
      header: "Event Name",
      minWidth: "240px",
      editable: mode === "EDIT",
      placeholder: "Event name"
    },
    {
      key: "category",
      header: "Category",
      minWidth: "180px",
      editable: mode === "EDIT",
      placeholder: "e.g. RUPANG"
    },
    {
      key: "eventType",
      header: "Type",
      minWidth: "150px",
      editable: mode === "EDIT",
      render: (row) => row.eventType.replace("_", " "),
      renderEditor: ({ value, onChange }) => (
        <select value={String(value ?? "STANDARD")} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          <option value="STANDARD">Standard</option>
          <option value="CAMPAIGN">Campaign</option>
          <option value="TIME_BASED">Time Based</option>
        </select>
      )
    },
    {
      key: "description",
      header: "Description",
      minWidth: "380px",
      editable: mode === "EDIT",
      placeholder: "Optional description"
    },
    {
      key: "activeFlag",
      header: "Status",
      width: "160px",
      minWidth: "150px",
      editable: mode === "EDIT",
      render: (row) => (
        <span className={`${styles.statusBadge} ${row.activeFlag ? styles.active : styles.inactive}`}>
          <span className={styles.statusDot} />
          {row.activeFlag ? "Active" : "Inactive"}
        </span>
      ),
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
            disabled={disabled || mode !== "EDIT"}
            onClick={() => onDelete(row.id)}
          />
        </div>
      )
    }
  ], [disabled, mode, onDelete]);

  return (
    <CollapsibleSection
      className={styles.tablePanel}
      title="Event Code Master"
      description="Review current values in Inquiry, or use Edit Event Codes to stage changes. Execute Event Codes saves this section."
      summary={`${totalCount} event codes`}
      defaultExpanded={false}
      actions={<div className={styles.tableToolbar}>
          <div className={styles.toolbarGroup}>
            <Button
              type="button"
              variant={mode === "INQUIRY" ? "primary" : "secondary"}
              size="sm"
              icon={<Eye size={15} />}
              onClick={() => onModeChange("INQUIRY")}
              disabled={loading || disabled}
            >
              Inquiry
            </Button>
            <Button
              type="button"
              variant={mode === "EDIT" ? "primary" : "secondary"}
              size="sm"
              icon={<PencilLine size={15} />}
              onClick={() => onModeChange("EDIT")}
              disabled={loading || disabled}
            >
              Edit Event Codes
            </Button>
          </div>
          <div className={styles.toolbarGroup}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<Download size={15} />}
              onClick={onDownloadTemplate}
              disabled={loading || disabled || templateDownloading}
            >
              {templateDownloading ? "Downloading..." : "Download Template"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<UploadCloud size={15} />}
              onClick={onBulkUpload}
              disabled={loading || disabled || mode !== "EDIT"}
            >
              Bulk Upload
            </Button>
          </div>
          <SearchInput
            value={search}
            onChange={(event) => {
              setPage(1);
              onSearchChange(event.target.value);
            }}
            placeholder="Search code, event, category, or updater..."
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
        </div>}
    >

      <DataTable
        rows={items}
        columns={columns}
        rowKey={(row) => row.id}
        loading={loading}
        disabled={disabled || mode !== "EDIT"}
        minWidth="1600px"
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
          }} disabled={disabled || mode !== "EDIT"}>
            Add
          </Button>
        )}
      />
    </CollapsibleSection>
  );
}
