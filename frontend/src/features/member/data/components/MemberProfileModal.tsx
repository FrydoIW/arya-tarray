"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { createMemberProfileFormValues, MemberProfileFields, normalizeMemberProfileForm } from "../../shared/MemberProfileFields";
import type { MemberDetail, MemberProfileInput } from "../types";
import styles from "../styles/member-data.module.css";

export function MemberProfileModal({ member, busy, error, onClose, onSubmit }: { member: MemberDetail; busy: boolean; error: string; onClose: () => void; onSubmit: (input: MemberProfileInput) => Promise<boolean> }) {
  const [values, setValues] = useState(() => ({
    ...createMemberProfileFormValues(member)
  }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: MemberProfileInput = normalizeMemberProfileForm(values);
    if (await onSubmit(input)) onClose();
  }
  const set = (key: keyof typeof values, value: string) => setValues(current => ({ ...current, [key]: value }));
  return <Modal open title="Edit profil donatur" description={`${member.memberCode} · Kode dan sumber registrasi tidak dapat diubah.`} onClose={onClose}>
    <form className={styles.modalBody} onSubmit={submit}>
      <div className={styles.formGrid}>
        <MemberProfileFields values={values} disabled={busy} context="profile" fieldClassName={styles.field}
          wideClassName={styles.wide} onChange={(key, value) => set(key, value)} />
      </div>
      {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}
      <div className={styles.footer}><Button variant="secondary" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" disabled={busy || !values.memberName.trim()}>{busy ? "Menyimpan…" : "Simpan profil"}</Button></div>
    </form>
  </Modal>;
}
