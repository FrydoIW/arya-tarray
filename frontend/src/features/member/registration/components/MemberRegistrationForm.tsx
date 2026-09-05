"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { currentBusinessDayValue } from "@/lib/business-time";
import type { MemberInput } from "../types";
import styles from "../styles/member-registration.module.css";
const fields = [
  ["memberName", "Member Name *", 150, "text"], ["initialName", "Initial Name", 100, "text"],
  ["birthDate", "Birth Date", 10, "date"], ["phone", "Phone", 50, "tel"],
  ["email", "Email", 150, "email"], ["city", "City", 100, "text"],
  ["address", "Address", 500, "text"], ["remark", "Remark", 500, "text"]
] as const;
export function MemberRegistrationForm({ name = "", initialName = "", busy, error, onClose, onSubmit }: {
  name?: string; initialName?: string; busy: boolean; error: string; onClose: () => void; onSubmit: (input: MemberInput) => Promise<boolean>;
}) {
  const [values, setValues] = useState({ memberName: name, initialName, birthDate: "", phone: "", email: "", city: "", address: "", remark: "" });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: MemberInput = { memberName: values.memberName.trim(), initialName: values.initialName.trim() || null,
      birthDate: values.birthDate || null, phone: values.phone.trim() || null, email: values.email.trim() || null,
      city: values.city.trim() || null, address: values.address.trim() || null, remark: values.remark.trim() || null };
    if (await onSubmit(input)) onClose();
  }
  return <form onSubmit={submit}>
    <div className={styles.formGrid}>{fields.map(([key, label, max, type]) => <label className={styles.field} key={key}>
      <span>{label}</span><input name={key} type={type} value={values[key]} required={key === "memberName"} maxLength={max}
        max={key === "birthDate" ? currentBusinessDayValue() : undefined} disabled={busy}
        onChange={e => setValues(current => ({ ...current, [key]: e.target.value }))} />
    </label>)}</div>
    {error ? <p className="ui-alert ui-alert-error" role="alert">{error}</p> : null}
    <div className={styles.footer}><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Batal</Button><Button type="submit" disabled={busy || !values.memberName.trim()}>{busy ? "Menyimpan…" : "Registrasi"}</Button></div>
  </form>;
}
