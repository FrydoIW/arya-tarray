"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleMinus, RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { formatDate, formatMoney } from "@/lib/format";
import { paymentOnlyTimePreview } from "@/lib/time-based-preview";
import type {
  DraftRowStatus,
  DraftRowStatusFilter,
  DraftTransaction,
  CampaignOption,
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
  campaigns: CampaignOption[];
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
  onFinalEventChange: (transactionId: string, eventCodeId: string | null, eventCampaignId?: string | null) => void;
  onRemarkChange: (transactionId: string, remark: string | null) => void;
};

function RowStatus({ status, outgoing }: { status: DraftRowStatus; outgoing: boolean }) {
  const icon = status === "NEEDS_REVIEW"
    ? <TriangleAlert size={12} />
    : status === "NOT_APPLICABLE"
      ? <CircleMinus size={12} />
      : <CheckCircle2 size={12} />;

  return <span className={`${styles.rowStatus} ${styles[`row${status}`]}`}>{icon}{outgoing ? "Outgoing" : getDraftRowStatusLabel(status)}</span>;
}

function RemarkCell({ row, disabled, onCommit }: { row: DraftTransaction; disabled: boolean; onCommit: (remark: string | null) => void }) {
  const [value, setValue] = useState(row.remark ?? "");
  useEffect(() => { setValue(row.remark ?? ""); }, [row.remark]);

  function commit() {
    const next = value.trim();
    if (next === (row.remark ?? "")) return;
    onCommit(next || null);
  }

  return (
    <input
      className="ui-table-input"
      value={value}
      disabled={disabled}
      maxLength={1000}
      placeholder="Operator note"
      aria-label={`Remark row ${row.rowNo}`}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
    />
  );
}

export function DraftTransactionReview({
  rows,
  eventCodes,
  campaigns,
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
  onFinalEventChange,
  onRemarkChange
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
        <div className={styles.descriptionCell} title={row.description}>
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
      minWidth: "160px",
      render: (row) => {
        if (!requiresEventClassification(row)) return <span className={styles.notApplicableText}>{row.direction === "DB" ? "Outgoing" : "Not applicable"}</span>;
        const suggested = getEventCode(eventCodes, row.suggestedEventCodeId);
        return suggested
          ? <span className={styles.suggestedEvent} title={getEventCodeLabel(suggested)}>{getEventCodeLabel(suggested)}</span>
          : <span className={styles.noMatch}>No Match</span>;
      }
    },
    {
      key: "eventCodeId",
      header: "Final Event",
      minWidth: "190px",
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
        const label = finalEvent ? getEventCodeLabel(finalEvent) : "Select Event...";
        return <span className={finalEvent ? styles.finalEvent : styles.noMatch} title={finalEvent ? label : undefined}>{label}</span>;
      }
    },
    {
      key: "program",
      header: "Program / Entitlement",
      minWidth: "190px",
      render: (row) => {
        const event = getEventCode(eventCodes, row.eventCodeId);
        if (event?.eventType === "TIME_BASED") {
          const rule = event.timeRule;
          if (!rule?.activeFlag || !row.baseAmount) return <span className={styles.notApplicableText}>Rule needed</span>;
          const preview = paymentOnlyTimePreview(row.originalAmount, rule.unitAmount, rule.durationMonths);
          return preview
            ? <span className={styles.entitlementCell}>
                <small>Rule: {formatMoney(rule.unitAmount)} / {rule.durationMonths} bln</small>
                <strong>Preview: {preview.months} bln · Carry {formatMoney(preview.remainder)}</strong>
              </span>
            : <span className={styles.noMatch}>Positive principal required</span>;
        }
        if (event?.eventType !== "CAMPAIGN") return <span className={styles.notApplicableText}>—</span>;
        const eligible = campaigns.filter((item) => item.eventCodeId === row.eventCodeId && ((item.activeFlag && (!item.startDate || row.transactionDate.slice(0, 10) >= item.startDate) && (!item.endDate || row.transactionDate.slice(0, 10) <= item.endDate)) || item.id === row.eventCampaignId));
        return <Select className={styles.eventSelect} value={row.eventCampaignId ?? ""} disabled={disabled} onChange={(event) => onFinalEventChange(row.id, row.eventCodeId ?? null, event.target.value || null)} aria-label={`Campaign row ${row.rowNo}`}>
          <option value="">Select Campaign...</option>
          {eligible.map((item) => <option key={item.id} value={item.id}>{item.campaignName}{!item.activeFlag ? " (historical)" : ""}</option>)}
        </Select>;
      }
    },
    {
      key: "remark",
      header: "Remark",
      minWidth: "180px",
      render: (row) => <RemarkCell row={row} disabled={disabled} onCommit={(remark) => onRemarkChange(row.id, remark)} />
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
      minWidth: "120px",
      sticky: "right",
      render: (row) => <RowStatus status={getDraftRowStatus(row, eventCodes)} outgoing={row.direction === "DB"} />
    }
  ], [disabled, eventCodes, campaigns, onFinalEventChange, onRemarkChange]);

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
        minWidth="1220px"
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
