"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SearchInput } from "@/components/ui/SearchInput";
import { formatDate } from "@/lib/format";
import * as api from "../api/member-data.api";
import type { Identity, IdentityOption, MemberOption } from "../types";
import styles from "../styles/member-data.module.css";

function OptionState({ loading, count, noun }: { loading: boolean; count: number; noun: string }) {
  if (loading) return <p className={styles.optionState}>Mencari…</p>;
  if (!count) return <p className={styles.optionState}>Tidak ada {noun} yang memenuhi syarat.</p>;
  return null;
}

export function AddIdentityModal({ memberId, busy, error, onClose, onSubmit }: { memberId: string; busy: boolean; error: string; onClose: () => void; onSubmit: (identityId: string) => Promise<boolean> }) {
  const [search, setSearch] = useState(""); const [options, setOptions] = useState<IdentityOption[]>([]); const [selected, setSelected] = useState(""); const [loading, setLoading] = useState(true);
  useEffect(() => { const controller = new AbortController(); const timer = setTimeout(() => { setLoading(true); api.getIdentityOptions(search.trim(), controller.signal).then(setOptions).catch(() => setOptions([])).finally(() => setLoading(false)); }, 250); return () => { clearTimeout(timer); controller.abort(); }; }, [search]);
  async function submit(event: FormEvent) { event.preventDefault(); if (selected && await onSubmit(selected)) onClose(); }
  return <Modal open title="Tambah identitas" description="Pilih identitas belum terverifikasi. Tidak ada pencocokan otomatis." onClose={onClose}>
    <form className={styles.modalBody} onSubmit={submit}>
      <SearchInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari nama rekening mentah…" />
      <div className={styles.options} role="radiogroup" aria-label="Identitas tersedia">
        <OptionState loading={loading} count={options.length} noun="identitas" />
        {options.map(option => <label key={option.memberIdentityId} className={styles.option}><input type="radio" name="identity" value={option.memberIdentityId} checked={selected === option.memberIdentityId} onChange={() => setSelected(option.memberIdentityId)} /><span><strong>{option.accountName}</strong><small>{option.sourceType} · {formatDate(option.firstSeenAt)}–{formatDate(option.lastSeenAt)} · {option.transactionCount} transaksi</small></span></label>)}
      </div>
      {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}
      <div className={styles.footer}><Button variant="secondary" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" disabled={busy || !selected}>{busy ? "Menghubungkan…" : "Tambah identitas"}</Button></div>
      <input type="hidden" value={memberId} readOnly />
    </form>
  </Modal>;
}

export function MoveIdentityModal({ memberId, identity, busy, error, onClose, onSubmit }: { memberId: string; identity: Identity; busy: boolean; error: string; onClose: () => void; onSubmit: (destinationMemberId: string) => Promise<boolean> }) {
  const [search, setSearch] = useState(""); const [options, setOptions] = useState<MemberOption[]>([]); const [selected, setSelected] = useState(""); const [loading, setLoading] = useState(true); const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { const controller = new AbortController(); const timer = setTimeout(() => { setLoading(true); api.getMemberOptions(search.trim(), memberId, controller.signal).then(setOptions).catch(() => setOptions([])).finally(() => setLoading(false)); }, 250); return () => { clearTimeout(timer); controller.abort(); }; }, [search, memberId]);
  async function submit(event: FormEvent) { event.preventDefault(); if (selected && confirmed && await onSubmit(selected)) onClose(); }
  return <Modal open title="Pindahkan identitas" description={`Identitas “${identity.accountName}” tetap menyimpan seluruh tautan transaksi.`} onClose={onClose}>
    <form className={styles.modalBody} onSubmit={submit}>
      <SearchInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari donatur tujuan aktif…" />
      <div className={styles.options} role="radiogroup" aria-label="Donatur tujuan">
        <OptionState loading={loading} count={options.length} noun="donatur aktif" />
        {options.map(option => <label key={option.memberId} className={styles.option}><input type="radio" name="member" value={option.memberId} checked={selected === option.memberId} onChange={() => { setSelected(option.memberId); setConfirmed(false); }} /><span><strong>{option.memberName}</strong><small>{option.memberCode}{option.city ? ` · ${option.city}` : ""}</small></span></label>)}
      </div>
      <label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>Saya memahami identitas akan berpindah ke donatur yang dipilih.</span></label>
      {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}
      <div className={styles.footer}><Button variant="secondary" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" disabled={busy || !selected || !confirmed}>{busy ? "Memindahkan…" : "Pindahkan"}</Button></div>
    </form>
  </Modal>;
}

export function EditIdentityModal({ identity, busy, error, onClose, onSubmit }: { identity: Identity; busy: boolean; error: string; onClose: () => void; onSubmit: (input: { initialName: string | null; remark: string | null }) => Promise<boolean> }) {
  const [initialName, setInitialName] = useState(identity.initialName ?? ""); const [remark, setRemark] = useState(identity.remark ?? "");
  async function submit(event: FormEvent) { event.preventDefault(); if (await onSubmit({ initialName: initialName.trim() || null, remark: remark.trim() || null })) onClose(); }
  return <Modal open title="Edit alias identitas" description="Nama rekening mentah dan kunci identitas dilindungi sebagai bukti sumber." onClose={onClose}>
    <form className={styles.modalBody} onSubmit={submit}>
      <div className={styles.evidence}><span>Nama rekening mentah</span><strong>{identity.accountName}</strong></div>
      <label className={styles.field}><span>Initial / alias</span><input value={initialName} maxLength={100} disabled={busy} onChange={e => setInitialName(e.target.value)} /></label>
      <label className={styles.field}><span>Catatan</span><textarea value={remark} maxLength={500} rows={4} disabled={busy} onChange={e => setRemark(e.target.value)} /></label>
      {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}
      <div className={styles.footer}><Button variant="secondary" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan metadata"}</Button></div>
    </form>
  </Modal>;
}

export function DetachIdentityModal({ identity, busy, error, onClose, onSubmit }: { identity: Identity; busy: boolean; error: string; onClose: () => void; onSubmit: () => Promise<boolean> }) {
  const [confirmed, setConfirmed] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); if (confirmed && await onSubmit()) onClose(); }
  return <Modal open title="Lepaskan identitas" description="Identitas akan kembali ke Registrasi Donatur sebagai belum terverifikasi." onClose={onClose}>
    <form className={styles.modalBody} onSubmit={submit}>
      <div className={styles.evidence}><span>Nama rekening mentah</span><strong>{identity.accountName}</strong><small>{identity.transactionCount} transaksi tetap terhubung ke identitas ini.</small></div>
      <label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>Saya memahami hubungan ke profil donatur ini akan dilepas.</span></label>
      {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}
      <div className={styles.footer}><Button variant="secondary" onClick={onClose} disabled={busy}>Batal</Button><Button variant="danger" type="submit" disabled={busy || !confirmed}>{busy ? "Melepaskan…" : "Lepaskan identitas"}</Button></div>
    </form>
  </Modal>;
}
