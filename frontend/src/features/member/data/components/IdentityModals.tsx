"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SearchInput } from "@/components/ui/SearchInput";
import { formatDate } from "@/lib/format";
import { isAbortError } from "@/lib/api";
import * as api from "../api/member-data.api";
import type { Identity, IdentityMetadataInput, IdentityOption, MemberOption } from "../types";
import styles from "../styles/member-data.module.css";

function useOptionLoader<T>(request: (signal: AbortSignal) => Promise<T[]>) {
  const [options, setOptions] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    const timer = window.setTimeout(async () => {
      try {
        const result = await request(controller.signal);
        if (!controller.signal.aborted) setOptions(result);
      } catch (caught) {
        if (!isAbortError(caught)) {
          setOptions([]);
          setLoadError(caught instanceof Error ? caught.message : "Pilihan gagal dimuat.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [request, retryKey]);
  return { options, loading, loadError, retry: () => setRetryKey(value => value + 1) };
}

function OptionState({ loading, count, noun, loadError, onRetry }: { loading: boolean; count: number; noun: string; loadError: string; onRetry: () => void }) {
  if (loading) return <p className={styles.optionState}>Mencari…</p>;
  if (loadError) return <div className="ui-alert ui-alert-error" role="alert">{loadError} <Button type="button" size="sm" variant="ghost" onClick={onRetry}>Coba lagi</Button></div>;
  if (!count) return <p className={styles.optionState}>Tidak ada {noun} yang memenuhi syarat.</p>;
  return null;
}

export function AddIdentityModal({ memberId, busy, error, onClose, onSubmit }: { memberId: string; busy: boolean; error: string; onClose: () => void; onSubmit: (identityId: string) => Promise<boolean> }) {
  const [search, setSearch] = useState(""); const [selected, setSelected] = useState("");
  const request = useCallback((signal: AbortSignal) => api.getIdentityOptions(search.trim(), signal), [search]);
  const { options, loading, loadError, retry } = useOptionLoader<IdentityOption>(request);
  const selectedIsCurrent = options.some(option => option.memberIdentityId === selected);
  async function submit(event: FormEvent) { event.preventDefault(); if (selectedIsCurrent && await onSubmit(selected)) onClose(); }
  return <Modal open title="Tambah identitas" description="Pilih identitas belum terverifikasi. Tidak ada pencocokan otomatis." onClose={onClose}>
    <form className={styles.modalBody} onSubmit={submit}>
      <SearchInput value={search} onChange={e => { setSearch(e.target.value); setSelected(""); }} placeholder="Cari nama rekening mentah…" />
      <div className={styles.options} role="radiogroup" aria-label="Identitas tersedia">
        <OptionState loading={loading} count={options.length} noun="identitas" loadError={loadError} onRetry={retry} />
        {options.map(option => <label key={option.memberIdentityId} className={styles.option}><input type="radio" name="identity" value={option.memberIdentityId} checked={selected === option.memberIdentityId} onChange={() => setSelected(option.memberIdentityId)} /><span><strong>{option.accountName}</strong><small>{option.sourceType} · {formatDate(option.firstSeenAt)}–{formatDate(option.lastSeenAt)} · {option.transactionCount} transaksi</small></span></label>)}
      </div>
      {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}
      <div className={styles.footer}><Button variant="secondary" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" disabled={busy || !selectedIsCurrent}>{busy ? "Menghubungkan…" : "Tambah identitas"}</Button></div>
      <input type="hidden" value={memberId} readOnly />
    </form>
  </Modal>;
}

export function MoveIdentityModal({ memberId, identity, busy, error, onClose, onSubmit }: { memberId: string; identity: Identity; busy: boolean; error: string; onClose: () => void; onSubmit: (destinationMemberId: string, reason: string) => Promise<boolean> }) {
  const [search, setSearch] = useState(""); const [selected, setSelected] = useState(""); const [confirmed, setConfirmed] = useState(false); const [reason, setReason] = useState("");
  const request = useCallback((signal: AbortSignal) => api.getMemberOptions(search.trim(), memberId, signal), [search, memberId]);
  const { options, loading, loadError, retry } = useOptionLoader<MemberOption>(request);
  const selectedIsCurrent = options.some(option => option.memberId === selected);
  async function submit(event: FormEvent) { event.preventDefault(); if (selectedIsCurrent && confirmed && reason.trim().length >= 3 && await onSubmit(selected, reason.trim())) onClose(); }
  return <Modal open title="Pindahkan identitas" description={`Identitas “${identity.accountName}” tetap menyimpan seluruh tautan transaksi.`} onClose={onClose}>
    <form className={styles.modalBody} onSubmit={submit}>
      <SearchInput value={search} onChange={e => { setSearch(e.target.value); setSelected(""); setConfirmed(false); }} placeholder="Cari donatur tujuan aktif…" />
      <div className={styles.options} role="radiogroup" aria-label="Donatur tujuan">
        <OptionState loading={loading} count={options.length} noun="donatur aktif" loadError={loadError} onRetry={retry} />
        {options.map(option => <label key={option.memberId} className={styles.option}><input type="radio" name="member" value={option.memberId} checked={selected === option.memberId} onChange={() => { setSelected(option.memberId); setConfirmed(false); }} /><span><strong>{option.memberName}</strong><small>{option.memberCode}{option.city ? ` · ${option.city}` : ""}</small></span></label>)}
      </div>
      <label className={styles.field}><span>Alasan pemindahan <b aria-hidden="true">*</b></span><textarea value={reason} maxLength={1000} rows={3} disabled={busy} onChange={e => setReason(e.target.value)} placeholder="Contoh: identitas terhubung ke donatur yang salah" /></label>
      <label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>Saya memahami identitas akan berpindah ke donatur yang dipilih.</span></label>
      {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}
      <div className={styles.footer}><Button variant="secondary" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" disabled={busy || !selectedIsCurrent || !confirmed || reason.trim().length < 3}>{busy ? "Memindahkan…" : "Pindahkan"}</Button></div>
    </form>
  </Modal>;
}

export function EditIdentityModal({ identity, busy, error, onClose, onSubmit }: { identity: Identity; busy: boolean; error: string; onClose: () => void; onSubmit: (input: IdentityMetadataInput) => Promise<boolean> }) {
  const [initialName, setInitialName] = useState(identity.initialName ?? "");
  const [bankName, setBankName] = useState(identity.bankName ?? "");
  const [accountNumber, setAccountNumber] = useState(identity.accountNumber ?? "");
  const [accountType, setAccountType] = useState(identity.accountType ?? "");
  const [remark, setRemark] = useState(identity.remark ?? "");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: IdentityMetadataInput = {
      initialName: initialName.trim() || null,
      bankName: bankName.trim() || null,
      accountNumber: accountNumber.trim() || null,
      accountType: accountType.trim() || null,
      remark: remark.trim() || null
    };
    if (await onSubmit(input)) onClose();
  }
  return <Modal open title="Edit identitas rekening" description="Lengkapi metadata yang diketahui. Nama rekening mentah tetap read-only sebagai bukti sumber." onClose={onClose}>
    <form className={styles.modalBody} onSubmit={submit}>
      <div className={styles.evidence}>
        <span>Nama rekening mentah</span>
        <strong>{identity.accountName}</strong>
        <small>Sumber: {identity.sourceType}</small>
      </div>
      <label className={styles.field}><span>Initial / alias</span><input value={initialName} maxLength={100} disabled={busy} onChange={e => setInitialName(e.target.value)} placeholder="Contoh: YOHANES" /></label>
      <label className={styles.field}><span>Bank</span><input value={bankName} maxLength={100} disabled={busy} onChange={e => setBankName(e.target.value)} placeholder="Contoh: Bank Mandiri" /></label>
      <label className={styles.field}><span>No. Rekening</span><input value={accountNumber} maxLength={100} disabled={busy} onChange={e => setAccountNumber(e.target.value)} placeholder="Isi jika diketahui" autoComplete="off" /></label>
      <label className={styles.field}><span>Tipe Rekening</span><input value={accountType} maxLength={100} disabled={busy} onChange={e => setAccountType(e.target.value)} placeholder="Contoh: Tabungan" /></label>
      <label className={styles.field}><span>Catatan</span><textarea value={remark} maxLength={500} rows={3} disabled={busy} onChange={e => setRemark(e.target.value)} placeholder="Catatan tambahan identitas (opsional)" /></label>
      {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}
      <div className={styles.footer}><Button variant="secondary" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan identitas"}</Button></div>
    </form>
  </Modal>;
}

export function DetachIdentityModal({ identity, busy, error, onClose, onSubmit }: { identity: Identity; busy: boolean; error: string; onClose: () => void; onSubmit: (reason: string) => Promise<boolean> }) {
  const [confirmed, setConfirmed] = useState(false); const [reason, setReason] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); if (confirmed && reason.trim().length >= 3 && await onSubmit(reason.trim())) onClose(); }
  return <Modal open title="Lepaskan identitas" description="Identitas akan kembali ke Registrasi Donatur sebagai belum terverifikasi." onClose={onClose}>
    <form className={styles.modalBody} onSubmit={submit}>
      <div className={styles.evidence}><span>Nama rekening mentah</span><strong>{identity.accountName}</strong><small>{identity.transactionCount} transaksi tetap terhubung ke identitas ini.</small></div>
      <label className={styles.field}><span>Alasan pelepasan <b aria-hidden="true">*</b></span><textarea value={reason} maxLength={1000} rows={3} disabled={busy} onChange={e => setReason(e.target.value)} placeholder="Contoh: identitas bukan milik donatur ini" /></label>
      <label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>Saya memahami hubungan ke profil donatur ini akan dilepas.</span></label>
      {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}
      <div className={styles.footer}><Button variant="secondary" onClick={onClose} disabled={busy}>Batal</Button><Button variant="danger" type="submit" disabled={busy || !confirmed || reason.trim().length < 3}>{busy ? "Melepaskan…" : "Lepaskan identitas"}</Button></div>
    </form>
  </Modal>;
}
