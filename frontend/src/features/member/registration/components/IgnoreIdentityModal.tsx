"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { Candidate } from "../types";
import styles from "../styles/member-registration.module.css";
export function IgnoreIdentityModal({ candidate, busy, error, onClose, onSubmit }: { candidate: Candidate; busy: boolean; error: string; onClose: () => void; onSubmit: (remark: string | null) => Promise<boolean> }) {
  const [remark, setRemark] = useState("");
  return <Modal open title="Abaikan Identitas" description={candidate.accountName} onClose={() => { if (!busy) onClose(); }}>
    <div className={styles.modalBody}><p>Identitas dan transaksi tetap tersimpan. Identitas dapat dilihat melalui status Diabaikan.</p>
      <label className={styles.field}><span>Remark (opsional)</span><textarea maxLength={500} disabled={busy} value={remark} onChange={e => setRemark(e.target.value)} /></label>
      {error ? <p className="ui-alert ui-alert-error" role="alert">{error}</p> : null}
      <div className={styles.footer}><Button variant="secondary" disabled={busy} onClick={onClose}>Batal</Button>
      <Button disabled={busy} onClick={async () => { if (await onSubmit(remark.trim() || null)) onClose(); }}>{busy ? "Menyimpan…" : "Ignore"}</Button></div>
    </div>
  </Modal>;
}
