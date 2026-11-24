"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  EventCodeChildOption,
  EventCodeOption
} from "../types";
import {
  childrenOfParent,
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
  eventCodeChildren: EventCodeChildOption[];
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
  onFinalEventChange: (transactionId: string, eventCodeId: string | null, eventCodeChildId?: string | null, eventCampaignId?: string | null) => void;
  onRemarkChange: (transactionId: string, remark: string | null) => void;
  onItemSaleQuantityChange: (transactionId: string, quantity: number | null) => Promise<boolean> | void;
};

function childLabel(child: EventCodeChildOption | null) {
  return child ? `${child.childCode} - ${child.childName}` : null;
}

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

function ItemSaleQuantityCell({
  row,
  child,
  disabled,
  onSave
}: {
  row: DraftTransaction;
  child: EventCodeChildOption;
  disabled: boolean;
  onSave: (quantity: number) => Promise<boolean> | void;
}) {
  const serverQuantity = row.itemSaleQuantity ?? row.itemSale?.quantity ?? null;
  const [value, setValue] = useState(serverQuantity == null ? "" : String(serverQuantity));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const focused = useRef(false);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);
  const latestSaved = useRef<number | null>(serverQuantity);
  const queued = useRef<number | null>(null);
  const attempted = useRef<number | null>(null);

  function clearTimer() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  useEffect(() => {
    if (!focused.current && !error && attempted.current === null) {
      setValue(serverQuantity == null ? "" : String(serverQuantity));
      latestSaved.current = serverQuantity;
    }
  }, [serverQuantity, error]);

  useEffect(() => () => clearTimer(), []);

  function parseQuantity(raw: string) {
    if (!/^\d+$/.test(raw.trim())) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  async function persist(quantity: number): Promise<boolean> {
    if (quantity === latestSaved.current) return true;
    if (inFlight.current) {
      queued.current = quantity;
      return false;
    }
    inFlight.current = true;
    setSaving(true);
    setError("");
    let saved = false;
    try {
      const result = await onSave(quantity);
      saved = result !== false;
      if (saved) {
        latestSaved.current = quantity;
        attempted.current = null;
      } else setError("Quantity could not be saved. Retry.");
    } catch {
      setError("Quantity could not be saved. Retry.");
    } finally {
      inFlight.current = false;
      setSaving(false);
      const next = queued.current;
      queued.current = null;
      if (next !== null && next !== latestSaved.current) void persist(next);
    }
    return saved;
  }

  function schedule(raw: string) {
    setValue(raw);
    setError("");
    clearTimer();
    const parsed = parseQuantity(raw);
    if (parsed === null) return;
    attempted.current = parsed;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void persist(parsed);
    }, 500);
  }

  function commit() {
    clearTimer();
    const parsed = parseQuantity(value);
    if (parsed === null) {
      setError(value.trim() ? "Enter a positive whole number." : "Quantity is required.");
      return;
    }
    void persist(parsed);
  }

  function retry() {
    const parsed = parseQuantity(value);
    if (parsed !== null) void persist(parsed);
  }

  const quantity = parseQuantity(value);
  const total = quantity ? String(Number(child.itemSaleUnitPrice) * quantity) : null;

  return <div className={styles.itemSaleCell}>
    <div className={styles.itemSalePrimary}>
      <input
        className={`ui-table-input ${styles.itemSaleQuantityInput}`}
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={`Item quantity row ${row.rowNo}`}
        onChange={event => schedule(event.target.value)}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; commit(); }}
        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
      />
      <span className={styles.itemSalePrice}>{formatMoney(child.itemSaleUnitPrice!)}<small>/ unit</small></span>
    </div>
    <div className={styles.itemSaleMeta}>
      <span>Stock {child.itemSaleStockOnHand ?? 0}</span>
      <span>{total ? `Total ${formatMoney(total)}` : "Quantity required"}</span>
      {row.itemSale?.status ? <span className={styles.itemSaleStatus}>{row.itemSale.status}</span> : null}
      {saving ? <span className={styles.itemSaleSaving}>Saving…</span> : null}
    </div>
    {error ? <div className={styles.itemSaleError} role="alert"><span>{error}</span><button type="button" onClick={retry} disabled={disabled || saving}>Retry</button></div> : null}
  </div>;
}

export function DraftTransactionReview({
  rows,
  eventCodes,
  eventCodeChildren,
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
  ,onItemSaleQuantityChange
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
      key: "eventCodeChildId",
      header: "Child",
      minWidth: "170px",
      render: (row) => {
        if (!requiresEventClassification(row) || !row.eventCodeId) return <span className={styles.notApplicableText}>—</span>;
        const parentChildren = childrenOfParent(eventCodeChildren, row.eventCodeId);
        if (parentChildren.length === 0) return <span className={styles.notApplicableText}>—</span>;
        if (disabled) {
          const selected = parentChildren.find((item) => item.id === row.eventCodeChildId) ?? null;
          return selected
            ? <span className={styles.finalEvent} title={childLabel(selected) ?? undefined}>{childLabel(selected)}{!selected.activeFlag ? " (historical)" : ""}</span>
            : <span className={styles.noMatch}>Select Child...</span>;
        }
        const eligible = parentChildren.filter((item) => item.activeFlag || item.id === row.eventCodeChildId);
        return (
          <Select
            className={styles.eventSelect}
            value={row.eventCodeChildId ?? ""}
            disabled={disabled}
            onChange={(event) => onFinalEventChange(row.id, row.eventCodeId ?? null, event.target.value || null, row.eventCampaignId ?? null)}
            aria-label={`Child row ${row.rowNo}`}
          >
            <option value="">Select Child...</option>
            {eligible.map((child) => (
              <option value={child.id} key={child.id}>{child.childCode} - {child.childName}{!child.activeFlag ? " (historical)" : ""}</option>
            ))}
          </Select>
        );
      }
    },
    {
      key: "itemSaleQuantity",
      header: "Item sale",
      minWidth: "210px",
      render: (row) => {
        const event = getEventCode(eventCodes, row.eventCodeId);
        if (event?.eventType !== "ITEM_SALE") return <span className={styles.notApplicableText}>—</span>;
        if (!row.eventCodeChildId) return <span className={styles.noMatch}>Select Child first</span>;
        const child = eventCodeChildren.find(item => item.id === row.eventCodeChildId);
        if (!child) return <span className={styles.noMatch}>Child configuration not found</span>;
        if (!child.itemSaleUnitPrice) return <span className={styles.noMatch} title={`Item config is missing for ${child.childCode}`}>Item config missing for {child.childCode}</span>;
        return <ItemSaleQuantityCell row={row} child={child as EventCodeChildOption} disabled={disabled}
          onSave={(quantity) => onItemSaleQuantityChange(row.id, quantity)} />;
      }
    },
    {
      key: "program",
      header: "Program / Entitlement",
      minWidth: "190px",
      render: (row) => {
        const event = getEventCode(eventCodes, row.eventCodeId);
        if (event?.eventType === "TIME_BASED") {
          const child = eventCodeChildren.find(item => item.id === row.eventCodeChildId);
          const rule = child
            ? child.unitAmount && child.durationMonths ? { unitAmount: child.unitAmount, durationMonths: child.durationMonths, activeFlag: child.activeFlag } : null
            : event.timeRule;
          if (!rule?.activeFlag) return <span className={styles.notApplicableText}>Rule needed</span>;
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
        return <Select className={styles.eventSelect} value={row.eventCampaignId ?? ""} disabled={disabled} onChange={(event) => onFinalEventChange(row.id, row.eventCodeId ?? null, row.eventCodeChildId ?? null, event.target.value || null)} aria-label={`Campaign row ${row.rowNo}`}>
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
      render: (row) => <RowStatus status={getDraftRowStatus(row, eventCodes, eventCodeChildren)} outgoing={row.direction === "DB"} />
    }
  ], [disabled, eventCodes, eventCodeChildren, campaigns, onFinalEventChange, onRemarkChange, onItemSaleQuantityChange]);

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
