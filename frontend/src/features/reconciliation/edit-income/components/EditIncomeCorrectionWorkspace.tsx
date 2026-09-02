"use client";

import { useMemo } from "react";
import { ArrowLeft, CheckCircle2, CircleMinus, RotateCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { formatDate, formatMoney } from "@/lib/format";
import type {
  CorrectionRowStatus,
  CorrectionRowStatusFilter,
  EditIncomeDetail,
  EditIncomeTransaction
} from "../types";
import {
  getCorrectionRowStatus,
  getEventCode,
  getEventCodeLabel
} from "../utils/edit-income.utils";
import styles from "../styles/edit-income.module.css";

type Props = {
  detail: EditIncomeDetail;
  rows: EditIncomeTransaction[];
  originalById: Map<string, EditIncomeTransaction>;
  search: string;
  statusFilter: CorrectionRowStatusFilter;
  page: number;
  pageSize: number;
  loading: boolean;
  busy: boolean;
  canEdit: boolean;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: CorrectionRowStatusFilter) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onReload: () => void;
  onBack: () => void;
  onTransactionChange: (transactionId: string, field: "eventCodeId" | "remark", value: string | null) => void;
};

function CorrectionStatus({ status }: { status: CorrectionRowStatus }) {
  const icon = status === "NOT_APPLICABLE" ? <CircleMinus size={12} /> : status === "MODIFIED" ? <Sparkles size={12} /> : <CheckCircle2 size={12} />;
  const label = status === "NOT_APPLICABLE" ? "Not Applicable" : status === "MODIFIED" ? "Modified" : "Current";
  return <span className={`${styles.rowStatus} ${styles[`row${status}`]}`}>{icon}{label}</span>;
}

export function EditIncomeCorrectionWorkspace(props: Props) {
  const { detail } = props;
  const columns = useMemo<DataTableColumn<EditIncomeTransaction>[]>(() => [
    {
      key: "transactionDate",
      header: "Date",
      minWidth: "110px",
      sticky: "left",
      render: (row) => <span className={styles.dateCell}>{row.transactionDate ? formatDate(row.transactionDate) : "-"}</span>
    },
    {
      key: "description",
      header: "Description",
      minWidth: "250px",
      render: (row) => (
        <div className={styles.descriptionCell}>
          <strong>{row.description || "-"}</strong>
          <small>{[row.transactionType, row.referenceNo, row.senderName].filter(Boolean).join(" · ") || "-"}</small>
        </div>
      )
    },
    {
      key: "originalAmount",
      header: "Amount",
      minWidth: "140px",
      align: "right",
      render: (row) => <span className={styles.amountCell}>{formatMoney(row.originalAmount)}</span>
    },
    {
      key: "suffixCode",
      header: "Suffix",
      minWidth: "78px",
      align: "center",
      render: (row) => row.requiresClassification
        ? <span className={styles.suffixChip}>{row.suffixCode ?? "-"}</span>
        : <span className={styles.notApplicableText}>N/A</span>
    },
    {
      key: "suggestedEventCodeId",
      header: "Suggested Event",
      minWidth: "180px",
      render: (row) => {
        if (!row.requiresClassification) return <span className={styles.notApplicableText}>Not applicable</span>;
        const suggested = getEventCode(detail.eventCodes, row.suggestedEventCodeId);
        return suggested
          ? <span className={styles.suggestedEvent}>{getEventCodeLabel(suggested)}</span>
          : <span className={styles.noMatch}>No Match</span>;
      }
    },
    {
      key: "eventCodeId",
      header: "Final Event",
      minWidth: "200px",
      editable: (row) => props.canEdit && row.requiresClassification,
      getValue: (row) => row.eventCodeId ?? "",
      renderEditor: ({ row, value, onChange }) => (
        <Select className={styles.eventSelect} value={String(value ?? "")} disabled={!props.canEdit || props.busy} onChange={(event) => onChange(event.target.value || null)} aria-label={`Final Event row ${row.rowNo}`}>
          <option value="">Select Event...</option>
          {detail.eventCodes.map((eventCode) => <option value={eventCode.id} key={eventCode.id}>{eventCode.code} - {eventCode.eventName}</option>)}
        </Select>
      ),
      render: (row) => {
        if (!row.requiresClassification) return <span className={styles.notApplicableText}>Not required</span>;
        const current = getEventCode(detail.eventCodes, row.eventCodeId);
        return <span className={current ? styles.finalEvent : styles.noMatch}>{current ? getEventCodeLabel(current) : "Select Event..."}</span>;
      }
    },
    {
      key: "remark",
      header: "Remark",
      minWidth: "190px",
      editable: () => props.canEdit,
      getValue: (row) => row.remark ?? "",
      renderEditor: ({ row, value, onChange }) => (
        <input
          className={`${styles.remarkInput} ui-table-input`}
          value={String(value ?? "")}
          maxLength={1000}
          disabled={!props.canEdit || props.busy}
          placeholder="Correction remark..."
          onChange={(event) => onChange(event.target.value)}
          aria-label={`Remark row ${row.rowNo}`}
        />
      ),
      render: (row) => <span className={row.remark ? styles.remarkText : styles.notApplicableText}>{row.remark || "-"}</span>
    },
    {
      key: "status",
      header: "Status",
      minWidth: "130px",
      sticky: "right",
      render: (row) => <CorrectionStatus status={getCorrectionRowStatus(row, props.originalById.get(row.id))} />
    }
  ], [detail.eventCodes, props.busy, props.canEdit, props.originalById]);

  return (
    <section className={styles.correctionPanel}>
      <div className={styles.correctionHeader}>
        <div>
          <div className={styles.correctionTitleRow}>
            <Button type="button" variant="ghost" size="sm" icon={<ArrowLeft size={14} />} disabled={props.busy} onClick={props.onBack}>Back</Button>
            <div><h2>Transaction Correction</h2><p>Suggested Event remains read-only. Only Final Event and Remark are editable before Execute.</p></div>
          </div>
        </div>
        <div className={styles.correctionToolbar}>
          <SearchInput value={props.search} disabled={props.loading} placeholder="Search description or reference" onChange={(event) => props.onSearchChange(event.target.value)} />
          <Select value={props.statusFilter} disabled={props.loading} onChange={(event) => props.onStatusFilterChange(event.target.value as CorrectionRowStatusFilter)} aria-label="Correction status">
            <option value="ALL">All Status</option>
            <option value="CURRENT">Current</option>
            <option value="MODIFIED">Modified</option>
            <option value="NOT_APPLICABLE">Not Applicable</option>
          </Select>
          <Button type="button" variant="secondary" size="sm" icon={<RotateCw size={14} className={props.loading ? "spin" : ""} />} disabled={props.loading || props.busy} onClick={props.onReload}>Reload</Button>
        </div>
      </div>

      <div className={styles.statementDetail}>
        <div><span>Statement ID</span><strong className={styles.monospace}>{detail.statement.id}</strong></div>
        <div><span>Bank Account</span><strong>{detail.statement.bankAccount.bankCode} - {detail.statement.bankAccount.accountNo}</strong></div>
        <div><span>Period</span><strong>{detail.statement.periodFrom ? formatDate(detail.statement.periodFrom) : "-"} - {detail.statement.periodTo ? formatDate(detail.statement.periodTo) : "-"}</strong></div>
        <div><span>Finalized At</span><strong>{detail.statement.finalizedAt ? formatDate(detail.statement.finalizedAt) : "-"}</strong></div>
        <div><span>Finalized By</span><strong>{detail.statement.finalizedBy?.fullName ?? "-"}</strong></div>
        <div><span>Status</span><strong className={styles.completeText}>{detail.statement.displayStatus === "COMPLETE" ? "Complete" : "Pending Re-approval"}</strong></div>
      </div>

      <DataTable
        rows={props.rows}
        columns={columns}
        rowKey={(row) => row.id}
        loading={props.loading}
        disabled={!props.canEdit || props.busy}
        minWidth="1480px"
        onCellChange={(row, columnKey, value) => {
          if (columnKey === "eventCodeId") props.onTransactionChange(row.id, "eventCodeId", value ? String(value) : null);
          if (columnKey === "remark") props.onTransactionChange(row.id, "remark", String(value ?? ""));
        }}
        emptyState={{ title: "No transactions", description: "Try another transaction search or status filter." }}
        pagination={{
          page: props.page,
          pageSize: props.pageSize,
          total: props.rows.length,
          pageSizeOptions: [10, 25, 50],
          onPageChange: props.onPageChange,
          onPageSizeChange: props.onPageSizeChange
        }}
      />
    </section>
  );
}
