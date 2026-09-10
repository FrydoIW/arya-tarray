"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { Candidate } from "../types";
import styles from "../styles/member-registration.module.css";

export function IgnoreIdentityModal({ candidate, busy, error, onClose, onSubmit }: { candidate: Candidate; busy: boolean; error: string; onClose: () => void; onSubmit: (reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  return <Modal open title="Abaikan Identitas" description={candidate.accountName} onClose={() => { if (!busy) onClose(); }}>
    <div className={styles.modalBody}><p>Identitas dan transaksi tetap tersimpan. Keputusan Ignore dicatat pada riwayat audit.</p>
      <label className={styles.field}><span>Alasan Ignore <b aria-hidden="true">*</b></span><textarea maxLength={500} rows={4} disabled={busy} value={reason} onChange={e => setReason(e.target.value)} placeholder="Jelaskan mengapa identitas tidak perlu diregistrasi" /></label>
      {error ? <p className="ui-alert ui-alert-error" role="alert">{error}</p> : null}
      <div className={styles.footer}><Button variant="secondary" disabled={busy} onClick={onClose}>Batal</Button>
      <Button disabled={busy || reason.trim().length < 3} onClick={async () => { if (await onSubmit(reason.trim())) onClose(); }}>{busy ? "Menyimpan…" : "Ignore"}</Button></div>
    </div>
  </Modal>;
}
