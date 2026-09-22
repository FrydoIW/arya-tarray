"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import type { DataTableColumn } from "@/components/ui/DataTable/types";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { subscriptionLabel } from "../program-allocation.utils";
import type { CarryTransferHistory, CarryTransferRecord } from "../types";
import styles from "../styles/program-allocation.module.css";

const shortId = (value: string) => `${value.slice(0, 8)}…`;

export function isReversible(row: CarryTransferRecord) {
  return row.status === "ACTIVE" && !row.reversal && !row.reversalOf;
}

type Props = {
  history: CarryTransferHistory | null;
  loading: boolean;
  error: string;
  canMutate: boolean;
  busy: boolean;
  onReverse: (row: CarryTransferRecord) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRefresh: () => void;
};

export function TransferHistoryPanel({ history, loading, error, canMutate, busy, onReverse, onPageChange, onPageSizeChange, onRefresh }: Props) {
  const columns: DataTableColumn<CarryTransferRecord>[] = [
    { key: "effectiveDate", header: "Tanggal", minWidth: "110px", render: row => formatDate(row.effectiveDate) },
    { key: "source", header: "Program Sumber", minWidth: "210px", render: row => row.source
      ? <div className={styles.name}><strong>{row.source.eventCode} · {row.source.eventName}</strong><small>{subscriptionLabel(row.source)}</small></div> : "—" },
    { key: "destination", header: "Program Tujuan", minWidth: "210px", render: row => row.destination
      ? <div className={styles.name}><strong>{row.destination.eventCode} · {row.destination.eventName}</strong><small>{subscriptionLabel(row.destination)}</small></div> : "—" },
    { key: "amount", header: "Jumlah", align: "right", minWidth: "130px", render: row => <strong className={styles.money}>{formatMoney(row.amount)}</strong> },
    { key: "status", header: "Status", minWidth: "100px", render: row => <span className={styles.statusPill} data-status={row.status}>{row.status}</span> },
    { key: "reason", header: "Reason", minWidth: "210px", render: row => <span className={styles.wrapText}>{row.reason}</span> },
    { key: "actor", header: "Actor", minWidth: "130px", render: row => row.createdBy ? row.createdBy.fullName : "—" },
    { key: "reversal", header: "Reversal", minWidth: "180px", render: row => {
      if (row.reversalOf) return <div className={styles.name}><strong>Reversal</strong><small>of {shortId(row.reversalOf.transferId)} · {row.reversalOf.status}</small></div>;
      if (row.reversal) return <div className={styles.name}><strong>Reversed</strong><small>by {shortId(row.reversal.transferId)} · {row.reversal.status}</small></div>;
      return "—";
    } },
    { key: "createdAt", header: "Dibuat", minWidth: "150px", render: row => formatDateTime(row.createdAt) }
  ];
  if (canMutate) columns.push({ key: "actions", header: "Aksi", sticky: "right", minWidth: "160px", render: row =>
    isReversible(row) ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReverse(row)}>Reverse Transfer</Button> : null });

  return <section className={styles.section} aria-labelledby="pa-transfer-history-title">
    <div className={styles.sectionHead}>
      <div><h2 id="pa-transfer-history-title">Transfer History</h2><p>Riwayat transfer carry yang dibatasi dan dipaginasi.</p></div>
      <Button size="sm" variant="outline" icon={<RefreshCw size={14} />} disabled={loading} onClick={onRefresh}>Muat ulang</Button>
    </div>
    {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}
    <DataTable rows={history?.rows ?? []} columns={columns} rowKey={row => row.transferId} loading={loading}
      minWidth="1420px" loadingText="Memuat riwayat transfer…"
      emptyState={{ title: "Belum ada transfer carry", description: "Transfer carry antar program TIME BASED akan muncul di sini." }}
      pagination={{ mode: "server", page: history?.pagination.page ?? 1, pageSize: history?.pagination.pageSize ?? 10,
        total: history?.pagination.total ?? 0, pageSizeOptions: [10, 25, 50],
        onPageChange, onPageSizeChange }} />
  </section>;
}
