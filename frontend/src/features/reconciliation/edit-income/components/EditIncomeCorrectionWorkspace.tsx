"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Eye, Pencil, Plus, RotateCw, ShieldMinus, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { IconButton } from "@/components/ui/IconButton";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { formatDate, formatMoney } from "@/lib/format";
import type { CorrectionDirectionFilter, CorrectionRowStatus, CorrectionRowStatusFilter, EditIncomeDetail, EditIncomeMode, EditIncomeTransaction, ManualAdjustmentInput } from "../types";
import { getCorrectionRowStatus, getEventCode, getEventCodeLabel } from "../utils/edit-income.utils";
import { AddAdjustmentModal, ExcludeTransactionModal } from "./CorrectionModals";
import styles from "../styles/edit-income.module.css";

type Props = {
  detail: EditIncomeDetail;
  rows: EditIncomeTransaction[];
  allRows: EditIncomeTransaction[];
  originalById: Map<string, EditIncomeTransaction>;
  search: string;
  statusFilter: CorrectionRowStatusFilter;
  eventCodeFilter: string;
  directionFilter: CorrectionDirectionFilter;
  mode: EditIncomeMode;
  correctionSummary: { modifiedTransactions: number; addedAdjustments: number; excludedTransactions: number };
  page: number;
  pageSize: number;
  loading: boolean;
  busy: boolean;
  canEdit: boolean;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: CorrectionRowStatusFilter) => void;
  onEventCodeFilterChange: (value: string) => void;
  onDirectionFilterChange: (value: CorrectionDirectionFilter) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onReload: () => void;
  onBack: () => void;
  onEditMode: () => void;
  onInquiryMode: () => void;
  onTransactionChange: (transactionId: string, field: "eventCodeId" | "eventCampaignId" | "remark", value: string | null) => void;
  onAddAdjustment: (input: ManualAdjustmentInput) => void;
  onExclude: (transactionId: string, reason: string) => void;
  onRestore: (transactionId: string) => void;
};

function CorrectionStatus({ status }: { status: CorrectionRowStatus }) {
  const icon = status === "MODIFIED" ? <Sparkles size={12} /> : status === "ADDED" ? <Plus size={12} /> : status === "EXCLUDED" ? <ShieldMinus size={12} /> : <CheckCircle2 size={12} />;
  const label = status === "MODIFIED" ? "Modified" : status === "ADDED" ? "Added" : status === "EXCLUDED" ? "Excluded" : "Current";
  return <span className={`${styles.rowStatus} ${styles[`row${status}`]}`}>{icon}{label}</span>;
}

function decimalToCents(value: string) {
  const negative = value.startsWith("-");
  const normalized = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const cents = BigInt(whole || "0") * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
  return negative ? -cents : cents;
}

function centsToDecimal(value: bigint) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / BigInt(100)}.${(absolute % BigInt(100)).toString().padStart(2, "0")}`;
}

export function EditIncomeCorrectionWorkspace(props: Props) {
  const { detail } = props;
  const [addOpen, setAddOpen] = useState(false);
  const [excludeTarget, setExcludeTarget] = useState<EditIncomeTransaction | null>(null);
  const proposedAmount = useMemo(() => {
    const absoluteCents = (value: string) => {
      const cents = decimalToCents(value);
      return cents < BigInt(0) ? -cents : cents;
    };

    // Statement total is gross bank activity (credit + absolute debit). Keep
    // manual/exclusion impact on that same basis instead of using signed net
    // movement, otherwise outgoing adjustments invert the displayed impact.
    let cents = decimalToCents(detail.statement.totalAmount);
    for (const row of props.allRows) {
      if (!row.correctionAction && row.sourceType === "MANUAL" && !row.reconciliationExcludedAt) {
        cents += absoluteCents(row.originalAmount);
      }
      if (!row.correctionAction && row.sourceType !== "MANUAL" && row.reconciliationExcludedAt) {
        cents -= absoluteCents(row.originalAmount);
      }
      if (row.correctionAction === "ADDED") {
        cents += absoluteCents(row.originalAmount);
      }
      if (row.correctionAction === "EXCLUDED" && row.sourceType !== "MANUAL") {
        cents -= absoluteCents(row.originalAmount);
      }
    }
    return centsToDecimal(cents);
  }, [detail.statement.totalAmount, props.allRows]);

  const columns = useMemo<DataTableColumn<EditIncomeTransaction>[]>(() => [
    { key: "transactionDate", header: "Date", minWidth: "110px", sticky: "left", render: (row) => <span className={styles.dateCell}>{row.transactionDate ? formatDate(row.transactionDate) : "-"}</span> },
    { key: "description", header: "Description", minWidth: "250px", render: (row) => <div className={styles.descriptionCell}><strong>{row.description || "-"}</strong><small>{[row.sourceType === "MANUAL" ? "MANUAL" : row.transactionType, row.referenceNo, row.senderName].filter(Boolean).join(" · ") || "-"}</small></div> },
    { key: "originalAmount", header: "Amount", minWidth: "140px", align: "right", render: (row) => <span className={styles.amountCell}>{formatMoney(row.originalAmount)}</span> },
    { key: "suggestedEventCodeId", header: "Suggested Event", minWidth: "180px", render: (row) => {
      if (row.sourceType === "MANUAL") return <span className={styles.notApplicableText}>Manual source</span>;
      if (!row.requiresClassification) return <span className={styles.notApplicableText}>Outgoing</span>;
      const suggested = getEventCode(detail.eventCodes, row.suggestedEventCodeId);
      return suggested ? <span className={styles.suggestedEvent}>{getEventCodeLabel(suggested)}</span> : <span className={styles.noMatch}>No Match</span>;
    } },
    {
      key: "eventCodeId", header: "Final Event", minWidth: "200px",
      editable: (row) => props.canEdit && row.requiresClassification && row.correctionAction !== "EXCLUDED" && !row.reconciliationExcludedAt,
      getValue: (row) => row.eventCodeId ?? "",
      renderEditor: ({ row, value, onChange }) => {
        const originalEventCodeId = props.originalById.get(row.id)?.eventCodeId ?? null;
        return <Select className={styles.eventSelect} value={String(value ?? "")} disabled={!props.canEdit || props.busy} onChange={(event) => onChange(event.target.value || null)} aria-label={`Final Event row ${row.rowNo || "manual"}`}><option value="">Select Event...</option>{detail.eventCodes.map((eventCode) => <option value={eventCode.id} key={eventCode.id} disabled={!eventCode.activeFlag && eventCode.id !== originalEventCodeId}>{eventCode.code} - {eventCode.eventName}{eventCode.activeFlag ? "" : " (Inactive)"}</option>)}</Select>;
      },
      render: (row) => {
        if (!row.requiresClassification) return <span className={styles.notApplicableText}>Outgoing</span>;
        const current = getEventCode(detail.eventCodes, row.eventCodeId);
        return <span className={current ? styles.finalEvent : styles.noMatch}>{current ? getEventCodeLabel(current) : "Select Event..."}</span>;
      }
    },
    {
      key: "eventCampaignId", header: "Campaign", minWidth: "190px",
      render: (row) => {
        if (getEventCode(detail.eventCodes, row.eventCodeId)?.eventType !== "CAMPAIGN") return <span className={styles.notApplicableText}>Not required</span>;
        const current = detail.campaigns.find((item) => item.id === row.eventCampaignId);
        if (!props.canEdit || row.correctionAction === "EXCLUDED" || row.reconciliationExcludedAt) return <span>{current?.campaignName ?? "Select Campaign..."}</span>;
        const eligible = detail.campaigns.filter((item) => item.eventCodeId === row.eventCodeId && ((item.activeFlag && (!item.startDate || (row.transactionDate ?? "").slice(0, 10) >= item.startDate) && (!item.endDate || (row.transactionDate ?? "").slice(0, 10) <= item.endDate)) || item.id === row.eventCampaignId));
        return <Select className={styles.eventSelect} value={row.eventCampaignId ?? ""} disabled={props.busy} onChange={(event) => props.onTransactionChange(row.id, "eventCampaignId", event.target.value || null)} aria-label={`Campaign row ${row.rowNo || "manual"}`}><option value="">Select Campaign...</option>{eligible.map((item) => <option key={item.id} value={item.id}>{item.campaignName}{!item.activeFlag ? " (historical)" : ""}</option>)}</Select>;
      }
    },
    { key: "sponsorshipPreview", header: "Rupang", minWidth: "145px", render: (row) => { const event = getEventCode(detail.eventCodes, row.eventCodeId); const rule = event?.eventType === "TIME_BASED" ? event.timeRule : null; if (!rule?.activeFlag || !row.baseAmount) return <span className={styles.notApplicableText}>{event?.eventType === "TIME_BASED" ? "Rule needed" : "—"}</span>; const units = Number(row.baseAmount) / Number(rule.unitAmount); return Number.isInteger(units) && units >= 1 ? <span className={styles.finalEvent}>+{units * rule.durationMonths} months</span> : <span className={styles.noMatch}>Exact unit required</span>; } },
    {
      key: "remark", header: "Remark", minWidth: "190px", editable: (row) => props.canEdit && row.correctionAction !== "EXCLUDED" && !row.reconciliationExcludedAt,
      getValue: (row) => row.remark ?? "",
      renderEditor: ({ row, value, onChange }) => <input className={`${styles.remarkInput} ui-table-input`} value={String(value ?? "")} maxLength={1000} disabled={!props.canEdit || props.busy} placeholder="Correction remark..." onChange={(event) => onChange(event.target.value)} aria-label={`Remark row ${row.rowNo || "manual"}`} />,
      render: (row) => <span className={row.remark ? styles.remarkText : styles.notApplicableText}>{row.remark || "-"}</span>
    },
    { key: "status", header: "Status", minWidth: "112px", render: (row) => <CorrectionStatus status={getCorrectionRowStatus(row, props.originalById.get(row.id))} /> },
    { key: "action", header: "Action", minWidth: "78px", sticky: "right", align: "center", render: (row) => {
      if (!props.canEdit) return <span className={styles.notApplicableText}>—</span>;
      if (row.correctionAction || row.reconciliationExcludedAt) return <IconButton label={row.correctionAction === "ADDED" ? "Remove staged adjustment" : "Undo staged exclusion"} icon={<Undo2 size={14} />} disabled={props.busy || Boolean(row.reconciliationExcludedAt)} onClick={() => props.onRestore(row.id)} />;
      return <IconButton label="Exclude from reconciliation" icon={<ShieldMinus size={14} />} variant="danger" disabled={props.busy} onClick={() => setExcludeTarget(row)} />;
    } }
  ], [detail.eventCodes, detail.campaigns, props.busy, props.canEdit, props.onRestore, props.originalById, props.onTransactionChange]);

  return (
    <section className={styles.correctionPanel}>
      <div className={styles.correctionHeader}>
        <div className={styles.correctionTitleRow}><Button type="button" variant="ghost" size="sm" icon={<ArrowLeft size={14} />} disabled={props.busy} onClick={props.onBack}>Back</Button><div><h2>Transaction Correction</h2><p>Open in Inquiry, then explicitly enter Edit Transactions to stage an approval proposal.</p></div></div>
        <div className={styles.modeActions}><Button type="button" variant={props.mode === "INQUIRY" ? "secondary" : "ghost"} size="sm" icon={<Eye size={14} />} disabled={props.busy || props.mode === "INQUIRY"} onClick={props.onInquiryMode}>Inquiry</Button><Button type="button" variant={props.mode === "EDIT" ? "secondary" : "outline"} size="sm" icon={<Pencil size={14} />} disabled={!detail.statement.editable || props.busy || props.mode === "EDIT"} onClick={props.onEditMode}>Edit Transactions</Button>{props.mode === "EDIT" ? <Button type="button" size="sm" icon={<Plus size={14} />} disabled={!props.canEdit} onClick={() => setAddOpen(true)}>Add Adjustment</Button> : null}</div>
      </div>

      <div className={styles.statementDetail}><div><span>Statement Detail</span><strong>{detail.statement.bankAccount.bankCode} • {detail.statement.bankAccount.accountNo}</strong></div><div><span>Period</span><strong>{detail.statement.periodFrom ? formatDate(detail.statement.periodFrom) : "-"} – {detail.statement.periodTo ? formatDate(detail.statement.periodTo) : "-"}</strong></div><div><span>Status</span><strong className={styles.completeText}>{detail.statement.displayStatus === "COMPLETE" ? "Complete" : "Pending Re-approval"}</strong></div><div><span>Original Statement Amount</span><strong>{formatMoney(detail.statement.totalAmount)}</strong></div><div><span>Proposed Corrected Amount</span><strong>{formatMoney(proposedAmount)}</strong></div></div>

      <div className={styles.correctionSummary}><div><span>Modified Transactions</span><strong>{props.correctionSummary.modifiedTransactions}</strong></div><div><span>Added Adjustments</span><strong>{props.correctionSummary.addedAdjustments}</strong></div><div><span>Excluded Transactions</span><strong>{props.correctionSummary.excludedTransactions}</strong></div></div>

      <div className={styles.correctionFilters}><SearchInput value={props.search} disabled={props.loading} placeholder="Search description or reference" onChange={(event) => props.onSearchChange(event.target.value)} /><Select value={props.statusFilter} disabled={props.loading} onChange={(event) => props.onStatusFilterChange(event.target.value as CorrectionRowStatusFilter)} aria-label="Correction status"><option value="ALL">All Status</option><option value="CURRENT">Current</option><option value="MODIFIED">Modified</option><option value="ADDED">Added</option><option value="EXCLUDED">Excluded</option></Select><Select value={props.eventCodeFilter} disabled={props.loading} onChange={(event) => props.onEventCodeFilterChange(event.target.value)} aria-label="Final Event filter"><option value="ALL">All Event Codes</option>{detail.eventCodes.map((eventCode) => <option value={eventCode.id} key={eventCode.id}>{eventCode.code} - {eventCode.eventName}{eventCode.activeFlag ? "" : " (Inactive)"}</option>)}</Select><Select value={props.directionFilter} disabled={props.loading} onChange={(event) => props.onDirectionFilterChange(event.target.value as CorrectionDirectionFilter)} aria-label="Direction filter"><option value="ALL">All Direction</option><option value="INCOMING">Incoming</option><option value="OUTGOING">Outgoing</option></Select><Button type="button" variant="secondary" size="sm" icon={<RotateCw size={14} className={props.loading ? "spin" : ""} />} disabled={props.loading || props.busy} onClick={props.onReload}>Reload</Button></div>

      <DataTable rows={props.rows} columns={columns} rowKey={(row) => row.id} loading={props.loading} disabled={!props.canEdit || props.busy} minWidth="1520px" onCellChange={(row, columnKey, value) => { if (columnKey === "eventCodeId") props.onTransactionChange(row.id, "eventCodeId", value ? String(value) : null); if (columnKey === "remark") props.onTransactionChange(row.id, "remark", String(value ?? "")); }} emptyState={{ title: "No transactions", description: "Try another transaction search or filter." }} pagination={{ page: props.page, pageSize: props.pageSize, total: props.rows.length, pageSizeOptions: [10, 25, 50], onPageChange: props.onPageChange, onPageSizeChange: props.onPageSizeChange }} />

      <AddAdjustmentModal open={addOpen} defaultDate={(detail.statement.periodTo ?? detail.statement.periodFrom ?? "").slice(0, 10)} eventCodes={detail.eventCodes.filter((eventCode) => eventCode.activeFlag)} campaigns={detail.campaigns} disabled={props.busy} onClose={() => setAddOpen(false)} onSubmit={props.onAddAdjustment} />
      <ExcludeTransactionModal transaction={excludeTarget} disabled={props.busy} onClose={() => setExcludeTarget(null)} onSubmit={props.onExclude} />
    </section>
  );
}
