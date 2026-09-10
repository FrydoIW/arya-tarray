"use client";
import Link from "next/link";
import { useMemo, useState, type KeyboardEvent } from "react";
import { ArrowLeft, Link2, Pencil, RefreshCw, Unlink, UserRoundPlus } from "lucide-react";
import { ScreenLoader } from "@/components/layout/ScreenLoader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import type { DataTableColumn } from "@/components/ui/DataTable/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuthSession } from "@/features/auth/context/AuthSessionContext";
import { formatDate, formatDateTime } from "@/lib/format";
import { useMemberDetail } from "../hooks/useMemberDetail";
import type { Identity } from "../types";
import { AddIdentityModal, DetachIdentityModal, EditIdentityModal, MoveIdentityModal } from "./IdentityModals";
import { MemberIdentityHistory } from "./MemberIdentityHistory";
import { MemberProfileModal } from "./MemberProfileModal";
import { MemberDonationHistory } from "./MemberDonationHistory";
import styles from "../styles/member-data.module.css";

type Action = { kind: "edit-profile" } | { kind: "add" } | { kind: "edit-identity" | "move" | "detach"; identity: Identity } | null;
type DetailTab = "profile" | "identities" | "ownership-history" | "donations";
function Field({ label, value, wide = false }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return <div className={`${styles.profileField} ${wide ? styles.wide : ""}`}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>;
}

export function MemberDetailScreen({ memberId, editProfileInitially = false }: { memberId: string; editProfileInitially?: boolean }) {
  const user = useAuthSession();
  const canMutate = user.menuCodes.includes("MEMBER_REGISTRATION");
  const state = useMemberDetail(memberId);
  const [tab, setTab] = useState<DetailTab>("profile");
  const [action, setAction] = useState<Action>(() => editProfileInitially ? { kind: "edit-profile" } : null);
  const tabs: DetailTab[] = ["profile", "identities", "ownership-history", "donations"];
  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = tabs.indexOf(tab);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    setTab(nextTab);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#member-tab-${nextTab}`)?.focus();
  }
  const columns = useMemo<DataTableColumn<Identity>[]>(() => {
    const base: DataTableColumn<Identity>[] = [
      { key: "accountName", header: "Nama Rekening Mentah", minWidth: "210px", render: row => <div className={styles.name}><strong>{row.accountName}</strong><small>Normalized: {row.normalizedName}</small></div> },
      { key: "initialName", header: "Initial", minWidth: "110px" },
      { key: "sourceType", header: "Sumber" },
      { key: "bankName", header: "Bank" }, { key: "accountNumber", header: "No. Rekening", minWidth: "130px" },
      { key: "accountType", header: "Tipe" }, { key: "firstSeenAt", header: "Pertama", render: row => formatDate(row.firstSeenAt) },
      { key: "lastSeenAt", header: "Terakhir", render: row => formatDate(row.lastSeenAt) },
      { key: "transactionCount", header: "Transaksi", align: "center" }
    ];
    if (!canMutate) return base;
    return [...base, { key: "actions", header: "Aksi", sticky: "right", minWidth: "230px", render: row => <div className={styles.rowActions}>
      <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setAction({ kind: "edit-identity", identity: row })}>Edit Identitas</Button>
      <Button size="sm" variant="ghost" icon={<Link2 size={14} />} onClick={() => setAction({ kind: "move", identity: row })}>Pindah</Button>
      <Button size="sm" variant="ghost" icon={<Unlink size={14} />} onClick={() => setAction({ kind: "detach", identity: row })}>Lepas</Button>
    </div> }];
  }, [canMutate]);
  if (state.loading && !state.detail) return <ScreenLoader />;
  if (!state.detail) return <div className="page-stack"><div className="ui-alert ui-alert-error" role="alert">{state.error || "Donatur tidak ditemukan."}</div><Link className={styles.backLink} href="/member/data"><ArrowLeft size={15} /> Kembali ke Data Donatur</Link></div>;
  const member = state.detail; const close = () => setAction(null);
  return <div className="page-stack">
    <PageHeader breadcrumb={["Donatur", "Data Donatur", member.memberCode]} title={member.memberName}
      description={`${member.memberCode} · ${member.registrationSource === "STATEMENT" ? "Berasal dari statement" : "Registrasi manual"}`}
      actions={<><Link className="ui-button ui-button-outline ui-button-md" href="/member/data"><span className="ui-button-icon" aria-hidden="true"><ArrowLeft size={15} /></span><span>Kembali</span></Link><Button variant="outline" icon={<RefreshCw size={15} />} onClick={state.refresh}>Muat ulang</Button></>} />
    {state.message ? <div className="ui-alert ui-alert-success" role="status">{state.message}</div> : null}
    {state.error && !action ? <div className="ui-alert ui-alert-error" role="alert">{state.error}</div> : null}
    {!canMutate ? <div className="ui-alert" role="status">Mode read-only. Akses Registrasi Donatur diperlukan untuk mengubah profil atau kepemilikan identitas.</div> : null}
    <section className={styles.hero}>
      <div className={styles.monogram} aria-hidden="true">{member.memberName.slice(0, 1).toUpperCase()}</div>
      <div><span className={styles.eyebrow}>PROFIL DONATUR</span><h2>{member.memberName}</h2><p>{member.initialName || "Initial belum dicatat"}{member.city ? ` · ${member.city}` : ""}</p></div>
      <StatusBadge active={member.activeFlag} activeLabel="Aktif" inactiveLabel="Nonaktif" />
    </section>
    <div className={styles.tabs} role="tablist" aria-label="Detail donatur">
      <button type="button" id="member-tab-profile" role="tab" aria-selected={tab === "profile"} aria-controls="member-panel-profile" tabIndex={tab === "profile" ? 0 : -1} className={tab === "profile" ? styles.activeTab : ""} onKeyDown={handleTabKeyDown} onClick={() => setTab("profile")}>Profil</button>
      <button type="button" id="member-tab-identities" role="tab" aria-selected={tab === "identities"} aria-controls="member-panel-identities" tabIndex={tab === "identities" ? 0 : -1} className={tab === "identities" ? styles.activeTab : ""} onKeyDown={handleTabKeyDown} onClick={() => setTab("identities")}>Identitas <span>{member.identities.length}</span></button>
      <button type="button" id="member-tab-ownership-history" role="tab" aria-selected={tab === "ownership-history"} aria-controls="member-panel-ownership-history" tabIndex={tab === "ownership-history" ? 0 : -1} className={tab === "ownership-history" ? styles.activeTab : ""} onKeyDown={handleTabKeyDown} onClick={() => setTab("ownership-history")}>Riwayat Kepemilikan</button>
      <button type="button" id="member-tab-donations" role="tab" aria-selected={tab === "donations"} aria-controls="member-panel-donations" tabIndex={tab === "donations" ? 0 : -1} className={tab === "donations" ? styles.activeTab : ""} onKeyDown={handleTabKeyDown} onClick={() => setTab("donations")}>Riwayat Donasi</button>
    </div>
    {tab === "profile" ? <section id="member-panel-profile" role="tabpanel" aria-labelledby="member-tab-profile" tabIndex={0} className={styles.detailPanel}>
      <div className={styles.sectionHead}><div><h2>Informasi profil</h2><p>Data kanonik donatur. Usia dihitung dari tanggal lahir.</p></div>{canMutate ? <Button icon={<Pencil size={15} />} onClick={() => { state.clearError(); setAction({ kind: "edit-profile" }); }}>Edit profil</Button> : null}</div>
      <dl className={styles.profileGrid}>
        <Field label="Kode Member" value={member.memberCode} /><Field label="Nama Donatur" value={member.memberName} />
        <Field label="Initial" value={member.initialName || "—"} /><Field label="Tanggal Lahir / Usia" value={member.birthDate ? `${formatDate(member.birthDate)} · ${member.age} tahun` : "—"} />
        <Field label="Telepon" value={member.phone || "—"} /><Field label="Email" value={member.email || "—"} />
        <Field label="Kota" value={member.city || "—"} /><Field label="Sumber Registrasi" value={member.registrationSource} />
        <Field label="Alamat" value={member.address || "—"} wide /><Field label="Catatan" value={member.remark || "—"} wide />
      </dl>
      <div className={styles.audit}>Terdaftar {formatDateTime(member.registeredAt)}{member.registeredBy ? ` oleh ${member.registeredBy.fullName}` : ""} · Terakhir diperbarui {formatDateTime(member.updatedAt)}{member.updatedBy ? ` oleh ${member.updatedBy.fullName}` : ""}</div>
    </section> : tab === "identities" ? <section id="member-panel-identities" role="tabpanel" aria-labelledby="member-tab-identities" tabIndex={0} className={styles.detailPanel}>
      <div className={styles.sectionHead}><div><h2>Identitas terhubung</h2><p>Nama rekening mentah dipertahankan sebagai bukti sumber.</p></div>{canMutate ? <Button icon={<UserRoundPlus size={15} />} disabled={!member.activeFlag} onClick={() => { state.clearError(); setAction({ kind: "add" }); }}>Tambah Identitas</Button> : null}</div>
      {canMutate && !member.activeFlag ? <div className="ui-alert ui-alert-error">Aktifkan donatur sebelum menambahkan identitas baru.</div> : null}
      <DataTable rows={member.identities} columns={columns} rowKey={row => row.memberIdentityId} minWidth={canMutate ? "1250px" : "1020px"} emptyState={{ title: "Belum ada identitas", description: "Tambahkan identitas belum terverifikasi ketika tersedia." }} />
    </section> : tab === "ownership-history" ? <div id="member-panel-ownership-history" role="tabpanel" aria-labelledby="member-tab-ownership-history" tabIndex={0}><MemberIdentityHistory memberId={memberId} /></div>
      : <div id="member-panel-donations" role="tabpanel" aria-labelledby="member-tab-donations" tabIndex={0}><MemberDonationHistory memberId={memberId} /></div>}
    {canMutate && action?.kind === "edit-profile" ? <MemberProfileModal member={member} busy={state.busy} error={state.error} onClose={close} onSubmit={state.updateProfile} /> : null}
    {canMutate && action?.kind === "add" ? <AddIdentityModal memberId={memberId} busy={state.busy} error={state.error} onClose={close} onSubmit={state.attach} /> : null}
    {canMutate && action?.kind === "edit-identity" ? <EditIdentityModal identity={action.identity} busy={state.busy} error={state.error} onClose={close} onSubmit={input => state.updateIdentity(action.identity.memberIdentityId, input)} /> : null}
    {canMutate && action?.kind === "move" ? <MoveIdentityModal memberId={memberId} identity={action.identity} busy={state.busy} error={state.error} onClose={close} onSubmit={(destination, reason) => state.move(action.identity.memberIdentityId, destination, reason)} /> : null}
    {canMutate && action?.kind === "detach" ? <DetachIdentityModal identity={action.identity} busy={state.busy} error={state.error} onClose={close} onSubmit={reason => state.detach(action.identity.memberIdentityId, reason)} /> : null}
  </div>;
}
