"use client";
import { CalendarCheck, HandCoins, History, RefreshCw, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import type { DataTableColumn } from "@/components/ui/DataTable/types";
import { MetricCard } from "@/components/ui/MetricCard";
import { PeriodPicker } from "@/components/ui/PeriodPicker";
import { Select } from "@/components/ui/Select";
import { currentBusinessDayValue, currentBusinessMonthValue } from "@/lib/business-time";
import { formatDate, formatMoney } from "@/lib/format";
import { useMemberDonations } from "../hooks/useMemberDonations";
import type { DonationRow } from "../types";
import styles from "../styles/member-data.module.css";

const columns: DataTableColumn<DonationRow>[] = [
  { key: "transactionDate", header: "Tanggal", minWidth: "110px", render: row => formatDate(row.transactionDate) },
  { key: "identity", header: "Sumber / Identitas", minWidth: "190px", render: row => <div className={styles.name}><strong>{row.identity?.accountName ?? "—"}</strong><small>{row.identity?.initialName || row.identity?.sourceType || "—"}</small></div> },
  { key: "referenceNo", header: "Referensi", minWidth: "140px" },
  { key: "description", header: "Deskripsi", minWidth: "220px" },
  { key: "finalEvent", header: "Final Event", minWidth: "170px", render: row => row.finalEvent ? <div className={styles.name}><strong>{row.finalEvent.eventCode}</strong><small>{row.finalEvent.eventName}</small></div> : "—" },
  { key: "category", header: "Kategori", minWidth: "120px", render: row => row.finalEvent?.category ?? "Uncategorized" },
  { key: "amount", header: "Jumlah", align: "right", minWidth: "145px", render: row => <strong className={styles.money}>{formatMoney(row.amount)}</strong> }
];

export function MemberDonationHistory({ memberId }: { memberId: string }) {
  const state = useMemberDonations(memberId); const summary = state.workspace.summary;
  return <section className={styles.donationStack}>
    <div className={styles.donationToolbar}>
      <div><h2>Riwayat Donasi</h2><p>Hanya transaksi masuk yang sudah FINALIZED dan memiliki Final Event aktual.</p></div>
      <div className={styles.periodControls}>
        <PeriodPicker value={{ mode: state.query.periodMode, month: state.query.month, date: state.query.date }} disabled={state.loading}
          maxMonth={currentBusinessMonthValue()} maxDate={currentBusinessDayValue()} ariaLabel="Periode donasi"
          onChange={period => state.updateQuery({ periodMode: period.mode, month: period.month, date: period.date })} />
        <Select aria-label="Filter Final Event" value={state.query.eventCodeId} disabled={state.loading} onChange={e => state.updateQuery({ eventCodeId: e.target.value })}>
          <option value="">Semua Final Event</option>{state.workspace.eventOptions.map(event => <option key={event.id} value={event.id}>{event.code} — {event.eventName}</option>)}
        </Select>
        <Button variant="outline" icon={<RefreshCw size={15} />} disabled={state.loading} onClick={state.reload}>Muat ulang</Button>
      </div>
    </div>
    {state.error ? <div className="ui-alert ui-alert-error" role="alert">{state.error}</div> : null}
    <div className={styles.donationSummary}>
      <MetricCard label="Lifetime Donation" value={formatMoney(summary.lifetimeAmount)} detail="Seluruh periode, semua event" icon={<HandCoins size={18} />} tone="maroon" />
      <MetricCard label="Lifetime Transactions" value={summary.lifetimeTransactionCount} detail="Transaksi donasi final" icon={<History size={18} />} tone="gold" />
      <MetricCard label="Period Donation" value={formatMoney(summary.periodAmount)} detail="Mengikuti filter periode/event" icon={<CalendarCheck size={18} />} tone="green" />
      <MetricCard label="Period Transactions" value={summary.periodTransactionCount} detail="Tidak terbatas halaman aktif" icon={<ReceiptText size={18} />} tone="blue" />
    </div>
    <div className={styles.detailPanel}>
      <DataTable rows={state.workspace.rows} columns={columns} rowKey={row => row.transactionId} loading={state.loading} minWidth="1150px"
        loadingText="Memuat riwayat donasi…" emptyState={{ title: "Tidak ada donasi pada konteks ini", description: "Coba periode atau Final Event lain. Lifetime totals tetap tidak berubah oleh filter." }}
        pagination={{ mode: "server", page: state.workspace.pagination.page, pageSize: state.workspace.pagination.pageSize,
          total: state.workspace.pagination.totalRows, onPageChange: page => state.updateQuery({ page }), onPageSizeChange: pageSize => state.updateQuery({ pageSize }) }} />
    </div>
    <div className={styles.breakdownGrid}>
      <section className={styles.breakdownPanel}><header><h3>Event Breakdown</h3><span>{state.workspace.eventBreakdown.length} event</span></header>
        {state.workspace.eventBreakdown.length ? <ul>{state.workspace.eventBreakdown.map(row => <li key={row.eventCodeId}><div><strong>{row.eventCode} · {row.eventName}</strong><small>{row.category} · {row.transactionCount} transaksi</small></div><b>{formatMoney(row.amount)}</b></li>)}</ul> : <p className={styles.breakdownEmpty}>Belum ada event pada periode ini.</p>}
      </section>
      <section className={styles.breakdownPanel}><header><h3>Category Breakdown</h3><span>{state.workspace.categoryBreakdown.length} kategori</span></header>
        {state.workspace.categoryBreakdown.length ? <ul>{state.workspace.categoryBreakdown.map(row => <li key={row.category}><div><strong>{row.category}</strong><small>{row.eventCount} event · {row.transactionCount} transaksi</small></div><b>{formatMoney(row.amount)}</b></li>)}</ul> : <p className={styles.breakdownEmpty}>Belum ada kategori pada periode ini.</p>}
      </section>
    </div>
  </section>;
}
