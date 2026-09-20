"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatDate, formatMoney } from "@/lib/format";
import { createIdempotencyKey, dependencyConflictHint, subscriptionLabel } from "../program-allocation.utils";
import type { CarryTransferRecord, CarryTransferReverseInput } from "../types";
import styles from "../styles/program-allocation.module.css";

type Props = {
  open: boolean;
  transfer: CarryTransferRecord | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: CarryTransferReverseInput) => Promise<boolean>;
};

export function ReverseTransferModal({ open, transfer, busy, error, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState("");
  const commandRef = useRef<{ key: string; payload: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    commandRef.current = null;
  }, [open, transfer?.transferId]);

  if (!transfer) return null;
  const reasonError = reason.trim().length < 3 ? "Reason pembalikan wajib diisi (minimal 3 karakter)." : null;
  const hint = error ? dependencyConflictHint(error) : null;

  async function submit() {
    if (busy || reasonError) return;
    const payload = reason.trim();
    if (!commandRef.current || commandRef.current.payload !== payload)
      commandRef.current = { key: createIdempotencyKey(), payload };
    await onSubmit({ reason: payload, idempotencyKey: commandRef.current.key });
  }

  return <Modal open={open} title="Reverse Transfer" description="Pembalikan append-only. Riwayat transfer asli tetap tersimpan."
    onClose={() => !busy && onClose()}>
    <form className={styles.modalBody} onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className={styles.sourceBox} data-tone="danger">
        <span>Original Transfer</span>
        <strong>{transfer.source ? `${transfer.source.eventCode} · ${transfer.source.eventName}` : "Program sumber"} → {transfer.destination ? `${transfer.destination.eventCode} · ${transfer.destination.eventName}` : "Program tujuan"}</strong>
        <small>{formatDate(transfer.effectiveDate)} · {transfer.source ? subscriptionLabel(transfer.source) : "—"}</small>
        <small>Reason: {transfer.reason}</small>
        <b>Amount <span className={styles.money}>{formatMoney(transfer.amount)}</span></b>
      </div>
      {error ? <div className="ui-alert ui-alert-error" role="alert">{error}{hint ? <small className={styles.hint}>{hint}</small> : null}</div> : null}
      <ul className={styles.warningBox}>
        <li>Pembalikan hanya mengembalikan carry yang belum terpakai.</li>
        <li>Coverage yang sudah terbentuk tidak dibuat ulang.</li>
        <li>Donasi asli dan Final Event tidak berubah.</li>
      </ul>
      <label className={styles.field}>Reason pembalikan
        <textarea required minLength={3} maxLength={1000} rows={3} value={reason} disabled={busy}
          onChange={event => setReason(event.target.value)} placeholder="Alasan membalikkan transfer…" />
        {reasonError ? <small className={styles.fieldError}>{reasonError}</small> : null}
      </label>
      <div className={styles.footer}>
        <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="danger" disabled={busy || Boolean(reasonError)}>{busy ? "Membalikkan…" : "Reverse Transfer"}</Button>
      </div>
    </form>
  </Modal>;
}
