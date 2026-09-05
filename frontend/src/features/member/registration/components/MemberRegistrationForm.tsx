"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { createMemberProfileFormValues, MemberProfileFields, normalizeMemberProfileForm } from "../../shared/MemberProfileFields";
import type { MemberInput } from "../types";
import styles from "../styles/member-registration.module.css";
export function MemberRegistrationForm({ name = "", initialName = "", busy, error, onClose, onSubmit }: {
  name?: string; initialName?: string; busy: boolean; error: string; onClose: () => void; onSubmit: (input: MemberInput) => Promise<boolean>;
}) {
  const [values, setValues] = useState(() => createMemberProfileFormValues({ memberName: name, initialName }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: MemberInput = normalizeMemberProfileForm(values);
    if (await onSubmit(input)) onClose();
  }
  return <form onSubmit={submit}>
    <div className={styles.formGrid}><MemberProfileFields values={values} disabled={busy} context="registration"
      fieldClassName={styles.field} onChange={(key, value) => setValues(current => ({ ...current, [key]: value }))} /></div>
    {error ? <p className="ui-alert ui-alert-error" role="alert">{error}</p> : null}
    <div className={styles.footer}><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Batal</Button><Button type="submit" disabled={busy || !values.memberName.trim()}>{busy ? "Menyimpan…" : "Registrasi"}</Button></div>
  </form>;
}
