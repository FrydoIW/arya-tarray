"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ContactRound, Eye, MoreHorizontal, Pencil, RefreshCw, UserCheck, UserMinus, UserRoundCheck, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataTable } from "@/components/ui/DataTable";
import type { DataTableColumn } from "@/components/ui/DataTable/types";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuthSession } from "@/features/auth/context/AuthSessionContext";
import { formatDate, formatMoney } from "@/lib/format";
import { useMemberData } from "../hooks/useMemberData";
import type { MemberRow } from "../types";
import styles from "../styles/member-data.module.css";

type LifecycleAction = { member: MemberRow; nextActiveFlag: boolean } | null;

export function MemberDataScreen() {
  const user = useAuthSession();
  const canMutate = user.menuCodes.includes("MEMBER_REGISTRATION");
  const state = useMemberData();
  const summary = state.workspace.summary;
  const [lifecycleAction, setLifecycleAction] = useState<LifecycleAction>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState("");

  const columns = useMemo<DataTableColumn<MemberRow>[]>(() => [
    { key: "memberCode", header: "Kode", minWidth: "150px", render: row => <strong className={styles.code} title={row.memberCode}>{row.memberCode}</strong> },
    { key: "memberName", header: "Nama Donatur", minWidth: "190px", render: row => <div className={styles.name}><strong>{row.memberName}</strong><small>{row.email || row.phone || "Kontak belum dicatat"}</small></div> },
    { key: "initialName", header: "Initial", minWidth: "110px" },
    { key: "age", header: "Usia", align: "center", render: row => row.age === null ? "—" : `${row.age} th` },
    { key: "city", header: "Kota", minWidth: "120px" },
    { key: "registrationSource", header: "Sumber", render: row => <span className={styles.source}>{row.registrationSource === "STATEMENT" ? "Statement" : "Manual"}</span> },
    { key: "identityCount", header: "Identitas", align: "center" },
    { key: "lifetimeDonation", header: "Lifetime Donation", align: "right", minWidth: "150px", render: row => <div className={`${styles.name} ${styles.amountCell}`}><strong>{formatMoney(row.lifetimeDonation)}</strong><small>{row.lifetimeTransactions} transaksi</small></div> },
    { key: "activeFlag", header: "Status", render: row => <StatusBadge active={row.activeFlag} activeLabel="Aktif" inactiveLabel="Nonaktif" /> },
    { key: "registeredAt", header: "Terdaftar", minWidth: "120px", render: row => formatDate(row.registeredAt) },
    { key: "action", header: "Aksi", minWidth: canMutate ? "220px" : "104px", render: row => <div className={styles.compactActions}>
      <Link className={styles.actionLink} href={`/member/data/${row.memberId}`} aria-label={`Buka detail ${row.memberName}`} title="Buka detail"><Eye size={15} aria-hidden="true" /><span>Lihat</span></Link>
      {canMutate ? <>
        <Link className={styles.actionLink} href={`/member/data/${row.memberId}?editProfile=1`} aria-label={`Edit profil ${row.memberName}`} title="Edit profil"><Pencil size={14} aria-hidden="true" /><span>Edit</span></Link>
        <details className={styles.lifecycleMenu}>
          <summary aria-label={`Aksi lain ${row.memberName}`} title="Aksi lain"><MoreHorizontal size={16} aria-hidden="true" /><span>Lainnya</span></summary>
          <div role="menu" className={styles.lifecycleMenuItems}>
            <button type="button" role="menuitem" onClick={() => { setLifecycleError(""); setLifecycleAction({ member: row, nextActiveFlag: !row.activeFlag }); }}>
              {row.activeFlag ? "Nonaktifkan Donatur" : "Aktifkan Donatur"}
            </button>
          </div>
        </details>
      </> : null}
    </div> }
  ], [canMutate]);

  async function confirmLifecycle() {
    if (!lifecycleAction) return;
    setLifecycleBusy(true);
    setLifecycleError("");
    try {
      await state.updateLifecycle(lifecycleAction.member.memberId, lifecycleAction.nextActiveFlag);
      setLifecycleAction(null);
    } catch (caught) {
      setLifecycleError(caught instanceof Error ? caught.message : "Status donatur gagal diperbarui.");
    } finally {
      setLifecycleBusy(false);
    }
  }

  return <div className="page-stack">
    <PageHeader breadcrumb={["Donatur", "Data Donatur"]} title="Data Donatur" description="Kelola profil kanonik dan seluruh identitas yang terhubung kepada donatur." />
    {state.error ? <div className="ui-alert ui-alert-error" role="alert">{state.error}</div> : null}
    {lifecycleError ? <div className="ui-alert ui-alert-error" role="alert">{lifecycleError}</div> : null}
    <div className={styles.summary}>
      <MetricCard label="Total Donatur" value={summary.total} detail="Seluruh profil" icon={<UsersRound size={18} />} tone="maroon" />
      <MetricCard label="Aktif" value={summary.active} detail="Dapat menerima identitas" icon={<UserCheck size={18} />} tone="green" />
      <MetricCard label="Nonaktif" value={summary.inactive} detail="Relasi tetap tersimpan" icon={<UserMinus size={18} />} tone="red" />
      <MetricCard label="Manual" value={summary.manual} detail="Registrasi langsung" icon={<ContactRound size={18} />} tone="gold" />
      <MetricCard label="Dari Statement" value={summary.statement} detail="Berawal dari identitas" icon={<UserRoundCheck size={18} />} tone="blue" />
    </div>
    <CollapsibleSection className={styles.panel} title="Daftar Donatur" summary={`${state.workspace.pagination.total} donatur`} defaultExpanded={false} actions={<div className={`${styles.toolbar} ${styles.collapsibleToolbar}`}>
      <SearchInput value={state.search} onChange={event => state.setSearch(event.target.value)} placeholder="Cari kode, nama, kontak, atau identitas…" />
      <Select aria-label="Filter status" value={state.query.status} onChange={event => state.updateQuery({ status: event.target.value as typeof state.query.status })}>
        <option value="ACTIVE">Aktif</option><option value="INACTIVE">Nonaktif</option><option value="ALL">Semua status</option>
      </Select>
      <Select aria-label="Filter kota" value={state.query.city} onChange={event => state.updateQuery({ city: event.target.value })}>
        <option value="">Semua kota</option>{state.workspace.filters.cities.map(city => <option key={city} value={city}>{city}</option>)}
      </Select>
      <Select aria-label="Filter sumber registrasi" value={state.query.registrationSource} onChange={event => state.updateQuery({ registrationSource: event.target.value as typeof state.query.registrationSource })}>
        <option value="ALL">Semua sumber</option><option value="MANUAL">Manual</option><option value="STATEMENT">Statement</option>
      </Select>
      <Button variant="outline" icon={<RefreshCw size={15} />} onClick={state.reload} disabled={state.loading}>Muat ulang</Button>
    </div>}>
      <DataTable rows={state.workspace.rows} columns={columns} rowKey={row => row.memberId} loading={state.loading}
        loadingText="Memuat data donatur…" emptyState={{ title: "Belum ada donatur", description: "Sesuaikan filter atau registrasikan donatur terlebih dahulu." }} minWidth="1580px"
        pagination={{ mode: "server", page: state.workspace.pagination.page, pageSize: state.workspace.pagination.pageSize,
          total: state.workspace.pagination.total, onPageChange: page => state.updateQuery({ page }), onPageSizeChange: pageSize => state.updateQuery({ pageSize }) }} />
    </CollapsibleSection>
    <ConfirmDialog open={Boolean(lifecycleAction)} loading={lifecycleBusy}
      title={lifecycleAction?.nextActiveFlag ? "Konfirmasi Aktivasi" : "Konfirmasi Nonaktifkan"}
      message={lifecycleAction?.nextActiveFlag
        ? `Aktifkan ${lifecycleAction.member.memberName}? Donatur aktif dapat menerima identitas baru sesuai aturan yang berlaku.`
        : `Nonaktifkan ${lifecycleAction?.member.memberName ?? "donatur"}? Identitas dan donasi historis tetap tersedia.`}
      confirmLabel={lifecycleAction?.nextActiveFlag ? "Aktifkan Donatur" : "Nonaktifkan Donatur"}
      loadingLabel="Menyimpan…" onCancel={() => { if (!lifecycleBusy) setLifecycleAction(null); }} onConfirm={confirmLifecycle} />
  </div>;
}
