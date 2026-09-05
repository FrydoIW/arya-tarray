"use client";
import Link from "next/link";
import { ContactRound, RefreshCw, UserCheck, UserMinus, UserRoundCheck, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import type { DataTableColumn } from "@/components/ui/DataTable/types";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { PeriodPicker } from "@/components/ui/PeriodPicker";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { currentBusinessDayValue, currentBusinessMonthValue } from "@/lib/business-time";
import { formatDate, formatMoney } from "@/lib/format";
import { useMemberData } from "../hooks/useMemberData";
import type { MemberRow } from "../types";
import styles from "../styles/member-data.module.css";

const columns: DataTableColumn<MemberRow>[] = [
  { key: "memberCode", header: "Kode", minWidth: "170px", render: row => <strong className={styles.code}>{row.memberCode}</strong> },
  { key: "memberName", header: "Nama Donatur", minWidth: "190px", render: row => <div className={styles.name}><strong>{row.memberName}</strong><small>{row.email || row.phone || "Kontak belum dicatat"}</small></div> },
  { key: "initialName", header: "Initial", minWidth: "110px" },
  { key: "age", header: "Usia", align: "center", render: row => row.age === null ? "—" : `${row.age} th` },
  { key: "city", header: "Kota", minWidth: "120px" },
  { key: "registrationSource", header: "Sumber", render: row => <span className={styles.source}>{row.registrationSource === "STATEMENT" ? "Statement" : "Manual"}</span> },
  { key: "identityCount", header: "Identitas", align: "center" },
  { key: "lifetimeDonation", header: "Lifetime Donation", align: "right", minWidth: "150px", render: row => <div className={`${styles.name} ${styles.amountCell}`}><strong>{formatMoney(row.lifetimeDonation)}</strong><small>{row.lifetimeTransactions} transaksi</small></div> },
  { key: "periodDonation", header: "Donasi Periode", align: "right", minWidth: "150px", render: row => <div className={`${styles.name} ${styles.amountCell}`}><strong>{formatMoney(row.periodDonation)}</strong><small>{row.periodTransactions} transaksi</small></div> },
  { key: "activeFlag", header: "Status", render: row => <StatusBadge active={row.activeFlag} activeLabel="Aktif" inactiveLabel="Nonaktif" /> },
  { key: "registeredAt", header: "Terdaftar", minWidth: "120px", render: row => formatDate(row.registeredAt) },
  { key: "action", header: "", sticky: "right", render: row => <Link className={styles.detailLink} href={`/member/data/${row.memberId}`}>Lihat detail</Link> }
];

export function MemberDataScreen() {
  const state = useMemberData();
  const summary = state.workspace.summary;
  return <div className="page-stack">
    <PageHeader breadcrumb={["Donatur", "Data Donatur"]} title="Data Donatur"
      description="Kelola profil kanonik dan seluruh identitas yang terhubung kepada donatur."
      actions={<Button variant="outline" icon={<RefreshCw size={16} />} onClick={state.reload} disabled={state.loading}>Muat ulang</Button>} />
    {state.error ? <div className="ui-alert ui-alert-error" role="alert">{state.error}</div> : null}
    <div className={styles.summary}>
      <MetricCard label="Total Donatur" value={summary.total} detail="Seluruh profil" icon={<UsersRound size={18} />} tone="maroon" />
      <MetricCard label="Aktif" value={summary.active} detail="Dapat menerima identitas" icon={<UserCheck size={18} />} tone="green" />
      <MetricCard label="Nonaktif" value={summary.inactive} detail="Relasi tetap tersimpan" icon={<UserMinus size={18} />} tone="red" />
      <MetricCard label="Manual" value={summary.manual} detail="Registrasi langsung" icon={<ContactRound size={18} />} tone="gold" />
      <MetricCard label="Dari Statement" value={summary.statement} detail="Berawal dari identitas" icon={<UserRoundCheck size={18} />} tone="blue" />
    </div>
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <SearchInput value={state.search} onChange={event => state.setSearch(event.target.value)} placeholder="Cari kode, nama, kontak, atau identitas…" />
        <PeriodPicker value={{ mode: state.query.periodMode, month: state.query.month, date: state.query.date }} disabled={state.loading}
          maxMonth={currentBusinessMonthValue()} maxDate={currentBusinessDayValue()} ariaLabel="Konteks donasi"
          onChange={period => state.updateQuery({ periodMode: period.mode, month: period.month, date: period.date })} />
        <Select aria-label="Filter Final Event" value={state.query.eventCodeId} disabled={state.loading} onChange={event => state.updateQuery({ eventCodeId: event.target.value })}>
          <option value="">Semua Final Event</option>{state.workspace.eventOptions.map(event => <option key={event.id} value={event.id}>{event.code} — {event.eventName}</option>)}
        </Select>
        <Select aria-label="Filter status" value={state.query.status} onChange={event => state.updateQuery({ status: event.target.value as typeof state.query.status })}>
          <option value="ACTIVE">Aktif</option><option value="INACTIVE">Nonaktif</option><option value="ALL">Semua status</option>
        </Select>
        <Select aria-label="Filter kota" value={state.query.city} onChange={event => state.updateQuery({ city: event.target.value })}>
          <option value="">Semua kota</option>{state.workspace.filters.cities.map(city => <option key={city} value={city}>{city}</option>)}
        </Select>
        <Select aria-label="Filter sumber registrasi" value={state.query.registrationSource} onChange={event => state.updateQuery({ registrationSource: event.target.value as typeof state.query.registrationSource })}>
          <option value="ALL">Semua sumber</option><option value="MANUAL">Manual</option><option value="STATEMENT">Statement</option>
        </Select>
      </div>
      <DataTable rows={state.workspace.rows} columns={columns} rowKey={row => row.memberId} loading={state.loading}
        loadingText="Memuat data donatur…" emptyState={{ title: "Belum ada donatur", description: "Sesuaikan filter atau registrasikan donatur terlebih dahulu." }} minWidth="1470px"
        pagination={{ mode: "server", page: state.workspace.pagination.page, pageSize: state.workspace.pagination.pageSize,
          total: state.workspace.pagination.total, onPageChange: page => state.updateQuery({ page }), onPageSizeChange: pageSize => state.updateQuery({ pageSize }) }} />
    </section>
  </div>;
}
