"use client";

import { useMemo } from "react";
import { CheckCircle2, CircleMinus, RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { formatDate, formatMoney } from "@/lib/format";
import type {
  DraftRowStatus,
  DraftRowStatusFilter,
  DraftTransaction,
  EventCodeOption
} from "../types";
import {
  getDraftRowStatus,
  getDraftRowStatusLabel,
  getEventCode,
  getEventCodeLabel,
  requiresEventClassification
} from "../utils/statement-upload.utils";
import styles from "../styles/statement-upload.module.css";

type Props = {
  rows: DraftTransaction[];
  eventCodes: EventCodeOption[];
  search: string;
  statusFilter: DraftRowStatusFilter;
  eventCodeFilter: string;
  page: number;
  pageSize: number;
  loading: boolean;
  disabled: boolean;
  selectedStatementId: string | null;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: DraftRowStatusFilter) => void;
  onEventCodeFilterChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onReload: () => void;
  onFinalEventChange: (transactionId: string, eventCodeId: string | null) => void;
};

function RowStatus({ status, outgoing }: { status: DraftRowStatus; outgoing: boolean }) {
  const icon = status === "NEEDS_REVIEW"
    ? <TriangleAlert size={12} />
    : status === "NOT_APPLICABLE"
      ? <CircleMinus size={12} />
      : <CheckCircle2 size={12} />;

  return <span className={`${styles.rowStatus} ${styles[`row${status}`]}`}>{icon}{outgoing ? "Outgoing" : getDraftRowStatusLabel(status)}</span>;
}

export function DraftTransactionReview({
  rows,
  eventCodes,
  search,
  statusFilter,
  eventCodeFilter,
  page,
  pageSize,
  loading,
  disabled,
  selectedStatementId,
  onSearchChange,
  onStatusFilterChange,
  onEventCodeFilterChange,
  onPageChange,
  onPageSizeChange,
  onReload,
  onFinalEventChange
}: Props) {
  const columns = useMemo<DataTableColumn<DraftTransaction>[]>(() => [
    {
      key: "transactionDate",
      header: "Date",
      minWidth: "112px",
      sticky: "left",
      render: (row) => <span className={styles.dateCell}>{formatDate(row.transactionDate)}</span>
    },
    {
      key: "description",
      header: "Description",
      minWidth: "260px",
      render: (row) => (
        <div className={styles.descriptionCell}>
          <strong>{row.description}</strong>
          <small>{[row.transactionType, row.referenceNo, row.senderName].filter(Boolean).join(" · ") || "-"}</small>
        </div>
      )
    },
    {
      key: "originalAmount",
      header: "Amount",
      minWidth: "145px",
      align: "right",
      render: (row) => (
        <span className={`${styles.amountCell} ${row.direction === "DB" ? styles.debitAmount : ""}`}>
          {formatMoney(row.originalAmount)}
        </span>
      )
    },
    {
      key: "suffixCode",
      header: "Suffix",
      minWidth: "82px",
      align: "center",
      render: (row) => requiresEventClassification(row)
        ? <span className={styles.suffixChip}>{row.suffixCode ?? "-"}</span>
        : <span className={styles.notApplicableText}>{row.direction === "DB" ? "Outgoing" : "N/A"}</span>
    },
    {
      key: "suggestedEventCodeId",
      header: "Suggested Event",
      minWidth: "185px",
      render: (row) => {
        if (!requiresEventClassification(row)) return <span className={styles.notApplicableText}>{row.direction === "DB" ? "Outgoing" : "Not applicable"}</span>;
        const suggested = getEventCode(eventCodes, row.suggestedEventCodeId);
        return suggested
          ? <span className={styles.suggestedEvent}>{getEventCodeLabel(suggested)}</span>
          : <span className={styles.noMatch}>No Match</span>;
      }
    },
    {
      key: "eventCodeId",
      header: "Final Event",
      minWidth: "205px",
      editable: (row) => !disabled && requiresEventClassification(row),
      getValue: (row) => row.eventCodeId ?? "",
      renderEditor: ({ row, value, onChange }) => (
        <Select
          className={styles.eventSelect}
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || null)}
          aria-label={`Final Event row ${row.rowNo}`}
        >
          <option value="">Select Event...</option>
          {eventCodes.map((eventCode) => (
            <option value={eventCode.id} key={eventCode.id}>{eventCode.code} - {eventCode.eventName}</option>
          ))}
        </Select>
      ),
      render: (row) => {
        if (!requiresEventClassification(row)) return <span className={styles.notApplicableText}>{row.direction === "DB" ? "Outgoing" : "Not required"}</span>;
        const finalEvent = getEventCode(eventCodes, row.eventCodeId);
        return <span className={finalEvent ? styles.finalEvent : styles.noMatch}>{finalEvent ? getEventCodeLabel(finalEvent) : "Select Event..."}</span>;
      }
    },
    {
      key: "finalEventCode",
      header: "Event Code",
      minWidth: "96px",
      align: "center",
      render: (row) => {
        if (row.direction === "DB") return <span className={styles.notApplicableText}>Outgoing</span>;
        const finalEvent = getEventCode(eventCodes, row.eventCodeId);
        return finalEvent
          ? <span className={styles.suffixChip}>{finalEvent.code}</span>
          : <span className={styles.notApplicableText}>-</span>;
      }
    },
    {
      key: "baseAmount",
      header: "Base Amount",
      minWidth: "145px",
      align: "right",
      render: (row) => <span className={styles.amountCell}>{row.baseAmount == null ? "-" : formatMoney(row.baseAmount)}</span>
    },
    {
      key: "status",
      header: "Status",
      minWidth: "135px",
      sticky: "right",
      render: (row) => <RowStatus status={getDraftRowStatus(row)} outgoing={row.direction === "DB"} />
    }
  ], [disabled, eventCodes]);

  return (
    <CollapsibleSection
      className={styles.tablePanel}
      title="Draft Transaction Review"
      description="Suggested Event is read-only. Final Event is the operator classification used for reconciliation."
      summary={`${rows.length} transactions`}
      defaultExpanded={false}
      actions={<div className={styles.tableToolbar}>
          <SearchInput
            value={search}
            disabled={loading}
            placeholder="Search description or reference"
            onChange={(event) => onSearchChange(event.target.value)}
          />
          <Select
            value={statusFilter}
            disabled={loading}
            onChange={(event) => onStatusFilterChange(event.target.value as DraftRowStatusFilter)}
            aria-label="Transaction review status"
          >
            <option value="ALL">All Status</option>
            <option value="MATCHED">Matched</option>
            <option value="READY">Ready</option>
            <option value="NEEDS_REVIEW">Needs Review</option>
            <option value="NOT_APPLICABLE">Outgoing / Not Applicable</option>
          </Select>
          <Select
            value={eventCodeFilter}
            disabled={loading}
            onChange={(event) => onEventCodeFilterChange(event.target.value)}
            aria-label="Final Event Code"
          >
            <option value="ALL">All Event Codes</option>
            {eventCodes.map((eventCode) => (
              <option key={eventCode.id} value={eventCode.id}>{eventCode.code} — {eventCode.eventName}</option>
            ))}
          </Select>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<RotateCw size={14} className={loading ? "spin" : ""} />}
            disabled={loading}
            onClick={onReload}
          >
            Reload
          </Button>
        </div>}
    >

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        loading={loading}
        disabled={disabled}
        minWidth="1356px"
        onCellChange={(row, columnKey, value) => {
          if (columnKey === "eventCodeId") onFinalEventChange(row.id, value ? String(value) : null);
        }}
        emptyState={selectedStatementId
          ? { title: "No draft transactions", description: "Try another search or review-status filter." }
          : { title: "No draft selected", description: "Select a statement draft above to continue." }}
        pagination={{
          page,
          pageSize,
          total: rows.length,
          pageSizeOptions: [10, 25, 50],
          onPageChange,
          onPageSizeChange
        }}
      />
    </CollapsibleSection>
  );
}
