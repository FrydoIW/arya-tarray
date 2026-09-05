"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Link2, Pencil, RefreshCw, Unlink, UserRoundPlus } from "lucide-react";
import { ScreenLoader } from "@/components/layout/ScreenLoader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import type { DataTableColumn } from "@/components/ui/DataTable/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatDate, formatDateTime } from "@/lib/format";
import { useMemberDetail } from "../hooks/useMemberDetail";
import type { Identity } from "../types";
import { AddIdentityModal, DetachIdentityModal, EditIdentityModal, MoveIdentityModal } from "./IdentityModals";
import { MemberProfileModal } from "./MemberProfileModal";
import { MemberDonationHistory } from "./MemberDonationHistory";
import styles from "../styles/member-data.module.css";

type Action = { kind: "edit-profile" } | { kind: "add" } | { kind: "edit-identity" | "move" | "detach"; identity: Identity } | null;
function Field({ label, value, wide = false }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return <div className={`${styles.profileField} ${wide ? styles.wide : ""}`}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>;
}

export function MemberDetailScreen({ memberId }: { memberId: string }) {
  const state = useMemberDetail(memberId); const [tab, setTab] = useState<"profile" | "identities" | "donations">("profile"); const [action, setAction] = useState<Action>(null);
  const columns = useMemo<DataTableColumn<Identity>[]>(() => [
    { key: "accountName", header: "Nama Rekening Mentah", minWidth: "210px", render: row => <div className={styles.name}><strong>{row.accountName}</strong><small>Normalized: {row.normalizedName}</small></div> },
    { key: "initialName", header: "Initial", minWidth: "110px" },
    { key: "sourceType", header: "Sumber" },
    { key: "bankName", header: "Bank" }, { key: "accountNumber", header: "No. Rekening", minWidth: "130px" },
    { key: "accountType", header: "Tipe" }, { key: "firstSeenAt", header: "Pertama", render: row => formatDate(row.firstSeenAt) },
    { key: "lastSeenAt", header: "Terakhir", render: row => formatDate(row.lastSeenAt) },
    { key: "transactionCount", header: "Transaksi", align: "center" },
    { key: "actions", header: "Aksi", sticky: "right", minWidth: "230px", render: row => <div className={styles.rowActions}>
      <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setAction({ kind: "edit-identity", identity: row })}>Alias</Button>
      <Button size="sm" variant="ghost" icon={<Link2 size={14} />} onClick={() => setAction({ kind: "move", identity: row })}>Pindah</Button>
      <Button size="sm" variant="ghost" icon={<Unlink size={14} />} onClick={() => setAction({ kind: "detach", identity: row })}>Lepas</Button>
    </div> }
  ], []);
  if (state.loading && !state.detail) return <ScreenLoader />;
  if (!state.detail) return <div className="page-stack"><div className="ui-alert ui-alert-error" role="alert">{state.error || "Donatur tidak ditemukan."}</div><Link className={styles.backLink} href="/member/data"><ArrowLeft size={15} /> Kembali ke Data Donatur</Link></div>;
  const member = state.detail; const close = () => setAction(null);
  return <div className="page-stack">
    <PageHeader breadcrumb={["Donatur", "Data Donatur", member.memberCode]} title={member.memberName}
      description={`${member.memberCode} · ${member.registrationSource === "STATEMENT" ? "Berasal dari statement" : "Registrasi manual"}`}
      actions={<><Link className={styles.backLink} href="/member/data"><ArrowLeft size={15} /> Kembali</Link><Button variant="outline" icon={<RefreshCw size={15} />} onClick={state.refresh}>Muat ulang</Button></>} />
    {state.message ? <div className="ui-alert ui-alert-success" role="status">{state.message}</div> : null}
    {state.error && !action ? <div className="ui-alert ui-alert-error" role="alert">{state.error}</div> : null}
    <section className={styles.hero}>
      <div className={styles.monogram} aria-hidden="true">{member.memberName.slice(0, 1).toUpperCase()}</div>
      <div><span className={styles.eyebrow}>PROFIL DONATUR</span><h2>{member.memberName}</h2><p>{member.initialName || "Initial belum dicatat"}{member.city ? ` · ${member.city}` : ""}</p></div>
      <StatusBadge active={member.activeFlag} activeLabel="Aktif" inactiveLabel="Nonaktif" />
    </section>
    <div className={styles.tabs} role="tablist"><button className={tab === "profile" ? styles.activeTab : ""} onClick={() => setTab("profile")}>Profil</button><button className={tab === "identities" ? styles.activeTab : ""} onClick={() => setTab("identities")}>Identitas <span>{member.identities.length}</span></button><button className={tab === "donations" ? styles.activeTab : ""} onClick={() => setTab("donations")}>Riwayat Donasi</button></div>
    {tab === "profile" ? <section className={styles.detailPanel}>
      <div className={styles.sectionHead}><div><h2>Informasi profil</h2><p>Data kanonik donatur. Usia dihitung dari tanggal lahir.</p></div><Button icon={<Pencil size={15} />} onClick={() => { state.clearError(); setAction({ kind: "edit-profile" }); }}>Edit profil</Button></div>
      <dl className={styles.profileGrid}>
        <Field label="Kode Member" value={member.memberCode} /><Field label="Nama Donatur" value={member.memberName} />
        <Field label="Initial" value={member.initialName || "—"} /><Field label="Tanggal Lahir / Usia" value={member.birthDate ? `${formatDate(member.birthDate)} · ${member.age} tahun` : "—"} />
        <Field label="Telepon" value={member.phone || "—"} /><Field label="Email" value={member.email || "—"} />
        <Field label="Kota" value={member.city || "—"} /><Field label="Sumber Registrasi" value={member.registrationSource} />
        <Field label="Alamat" value={member.address || "—"} wide /><Field label="Catatan" value={member.remark || "—"} wide />
      </dl>
      <div className={styles.audit}>Terdaftar {formatDateTime(member.registeredAt)}{member.registeredBy ? ` oleh ${member.registeredBy.fullName}` : ""} · Terakhir diperbarui {formatDateTime(member.updatedAt)}{member.updatedBy ? ` oleh ${member.updatedBy.fullName}` : ""}</div>
    </section> : tab === "identities" ? <section className={styles.detailPanel}>
      <div className={styles.sectionHead}><div><h2>Identitas terhubung</h2><p>Nama rekening mentah dipertahankan sebagai bukti sumber.</p></div><Button icon={<UserRoundPlus size={15} />} disabled={!member.activeFlag} onClick={() => { state.clearError(); setAction({ kind: "add" }); }}>Tambah Identitas</Button></div>
      {!member.activeFlag ? <div className="ui-alert ui-alert-error">Aktifkan donatur sebelum menambahkan identitas baru.</div> : null}
      <DataTable rows={member.identities} columns={columns} rowKey={row => row.memberIdentityId} minWidth="1250px" emptyState={{ title: "Belum ada identitas", description: "Tambahkan identitas belum terverifikasi ketika tersedia." }} />
    </section> : <MemberDonationHistory memberId={memberId} />}
    {action?.kind === "edit-profile" ? <MemberProfileModal member={member} busy={state.busy} error={state.error} onClose={close} onSubmit={state.updateProfile} /> : null}
    {action?.kind === "add" ? <AddIdentityModal memberId={memberId} busy={state.busy} error={state.error} onClose={close} onSubmit={state.attach} /> : null}
    {action?.kind === "edit-identity" ? <EditIdentityModal identity={action.identity} busy={state.busy} error={state.error} onClose={close} onSubmit={input => state.updateIdentity(action.identity.memberIdentityId, input)} /> : null}
    {action?.kind === "move" ? <MoveIdentityModal memberId={memberId} identity={action.identity} busy={state.busy} error={state.error} onClose={close} onSubmit={destination => state.move(action.identity.memberIdentityId, destination)} /> : null}
    {action?.kind === "detach" ? <DetachIdentityModal identity={action.identity} busy={state.busy} error={state.error} onClose={close} onSubmit={() => state.detach(action.identity.memberIdentityId)} /> : null}
  </div>;
}
