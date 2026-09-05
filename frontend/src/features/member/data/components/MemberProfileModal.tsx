"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { currentBusinessDayValue } from "@/lib/business-time";
import type { MemberDetail, MemberProfileInput } from "../types";
import styles from "../styles/member-data.module.css";

export function MemberProfileModal({ member, busy, error, onClose, onSubmit }: { member: MemberDetail; busy: boolean; error: string; onClose: () => void; onSubmit: (input: MemberProfileInput) => Promise<boolean> }) {
  const [values, setValues] = useState({ memberName: member.memberName, initialName: member.initialName ?? "", birthDate: member.birthDate ?? "", phone: member.phone ?? "", email: member.email ?? "", city: member.city ?? "", address: member.address ?? "", remark: member.remark ?? "", activeFlag: member.activeFlag });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: MemberProfileInput = { memberName: values.memberName.trim(), initialName: values.initialName.trim() || null,
      birthDate: values.birthDate || null, phone: values.phone.trim() || null, email: values.email.trim() || null,
      city: values.city.trim() || null, address: values.address.trim() || null, remark: values.remark.trim() || null, activeFlag: values.activeFlag };
    if (await onSubmit(input)) onClose();
  }
  const set = (key: keyof typeof values, value: string | boolean) => setValues(current => ({ ...current, [key]: value }));
  return <Modal open title="Edit profil donatur" description={`${member.memberCode} · Kode dan sumber registrasi tidak dapat diubah.`} onClose={onClose}>
    <form className={styles.modalBody} onSubmit={submit}>
      <div className={styles.formGrid}>
        <label className={styles.field}><span>Nama Donatur *</span><input value={values.memberName} maxLength={150} required disabled={busy} onChange={e => set("memberName", e.target.value)} /></label>
        <label className={styles.field}><span>Initial</span><input value={values.initialName} maxLength={100} disabled={busy} onChange={e => set("initialName", e.target.value)} /></label>
        <label className={styles.field}><span>Tanggal Lahir</span><input type="date" value={values.birthDate} max={currentBusinessDayValue()} disabled={busy} onChange={e => set("birthDate", e.target.value)} /></label>
        <label className={styles.field}><span>Telepon</span><input type="tel" value={values.phone} maxLength={50} disabled={busy} onChange={e => set("phone", e.target.value)} /></label>
        <label className={styles.field}><span>Email</span><input type="email" value={values.email} maxLength={150} disabled={busy} onChange={e => set("email", e.target.value)} /></label>
        <label className={styles.field}><span>Kota</span><input value={values.city} maxLength={100} disabled={busy} onChange={e => set("city", e.target.value)} /></label>
        <label className={`${styles.field} ${styles.wide}`}><span>Alamat</span><textarea value={values.address} maxLength={500} rows={3} disabled={busy} onChange={e => set("address", e.target.value)} /></label>
        <label className={`${styles.field} ${styles.wide}`}><span>Catatan</span><textarea value={values.remark} maxLength={500} rows={3} disabled={busy} onChange={e => set("remark", e.target.value)} /></label>
        <label className={`${styles.toggle} ${styles.wide}`}><input type="checkbox" checked={values.activeFlag} disabled={busy} onChange={e => set("activeFlag", e.target.checked)} /><span><strong>Donatur aktif</strong><small>Nonaktif tidak dapat dipilih untuk identitas baru; relasi historis tetap utuh.</small></span></label>
      </div>
      {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}
      <div className={styles.footer}><Button variant="secondary" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" disabled={busy || !values.memberName.trim()}>{busy ? "Menyimpan…" : "Simpan profil"}</Button></div>
    </form>
  </Modal>;
}
