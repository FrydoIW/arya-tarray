"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { Select } from "@/components/ui/Select";
import { formatMoney } from "@/lib/format";
import { centsToMoney, createIdempotencyKey, dependencyConflictHint, moneyToCents, subscriptionLabel, transferEstimate, validateTransferAmount } from "../program-allocation.utils";
import type { CarryTransferInput, SponsorshipSubscription } from "../types";
import styles from "../styles/program-allocation.module.css";

type Props = {
  open: boolean;
  source: SponsorshipSubscription | null;
  destinations: SponsorshipSubscription[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: CarryTransferInput) => Promise<boolean>;
};

export function TransferCarryModal({ open, source, destinations, busy, error, onClose, onSubmit }: Props) {
  const [destinationId, setDestinationId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const commandRef = useRef<{ key: string; payload: string } | null>(null);
  const destinationsRef = useRef(destinations);
  destinationsRef.current = destinations;

  useEffect(() => {
    if (!open || !source) return;
    setDestinationId(destinationsRef.current[0]?.subscriptionId ?? "");
    setAmount(source.carryBalance);
    setReason("");
    commandRef.current = null;
  }, [open, source]);

  if (!source) return null;
  const destination = destinations.find(item => item.subscriptionId === destinationId) ?? null;
  const amountError = validateTransferAmount(amount, source.carryBalance);
  const reasonError = reason.trim().length < 3 ? "Reason wajib diisi (minimal 3 karakter)." : null;
  const destinationError = destination ? null : "Pilih program tujuan.";
  const invalid = Boolean(amountError || reasonError || destinationError);
  const estimate = destination?.timeRule
    ? transferEstimate({ amount, destinationCarry: destination.carryBalance, unitAmount: destination.timeRule.unitAmount, durationMonths: destination.timeRule.durationMonths })
    : null;
  const hint = error ? dependencyConflictHint(error) : null;

  async function submit() {
    if (busy || invalid || !destination) return;
    const cents = moneyToCents(amount);
    if (cents === null) return;
    const normalized = centsToMoney(cents);
    const payload = JSON.stringify({ destinationSubscriptionId: destination.subscriptionId, amount: normalized, reason: reason.trim() });
    if (!commandRef.current || commandRef.current.payload !== payload)
      commandRef.current = { key: createIdempotencyKey(), payload };
    await onSubmit({ destinationSubscriptionId: destination.subscriptionId, amount: normalized, reason: reason.trim(), idempotencyKey: commandRef.current.key });
  }

  return <Modal open={open} title="Transfer Carry" description="Memindahkan saldo carry yang belum terpakai antar program TIME BASED milik donatur yang sama."
    onClose={() => !busy && onClose()}>
    <form className={styles.modalBody} onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className={styles.sourceBox}>
        <span>Source Program</span>
        <strong>{source.event.code} · {source.event.eventName}</strong>
        <small>{subscriptionLabel(source)}</small>
        <b>Available Carry <span className={styles.money}>{formatMoney(source.carryBalance)}</span></b>
      </div>
      {error ? <div className="ui-alert ui-alert-error" role="alert">{error}{hint ? <small className={styles.hint}>{hint}</small> : null}</div> : null}
      <label className={styles.field}>Transfer Amount
        <MoneyInput value={amount} disabled={busy} onValueChange={setAmount} aria-label="Transfer amount" />
        <small className={styles.helper}>Default seluruh carry. Partial diperbolehkan.</small>
        {amountError ? <small className={styles.fieldError}>{amountError}</small> : null}
      </label>
      <label className={styles.field}>Destination Program
        <Select value={destinationId} disabled={busy || !destinations.length} onChange={event => setDestinationId(event.target.value)} aria-label="Destination program">
          {destinations.map(item => <option key={item.subscriptionId} value={item.subscriptionId}>
            {item.event.code} · {item.event.eventName} — {subscriptionLabel(item)}
          </option>)}
        </Select>
        {destinationError ? <small className={styles.fieldError}>{destinationError}</small> : null}
      </label>
      {destination ? <div className={styles.ruleBox}>
        <span>Destination Current Rule</span>
        <strong>{destination.timeRule ? `${formatMoney(destination.timeRule.unitAmount)} / ${destination.timeRule.durationMonths} bln` : "Tidak ada rule aktif"}</strong>
        <small>Destination carry saat ini {formatMoney(destination.carryBalance)}</small>
      </div> : null}
      {estimate ? <div className={styles.previewBox}>
        <span>Estimated Result <small>perkiraan — backend tetap otoritatif</small></span>
        <div className={styles.previewRow}><span>Generated coverage</span><b>{estimate.months > 0 ? `${estimate.units} unit · ${estimate.months} bln` : "Belum cukup untuk 1 unit"}</b></div>
        <div className={styles.previewRow}><span>Amount applied</span><b className={styles.money}>{formatMoney(estimate.amountApplied)}</b></div>
        <div className={styles.previewRow}><span>Remaining destination carry</span><b className={styles.money}>{formatMoney(estimate.remainingCarry)}</b></div>
      </div> : null}
      <label className={styles.field}>Reason
        <textarea required minLength={3} maxLength={1000} rows={3} value={reason} disabled={busy}
          onChange={event => setReason(event.target.value)} placeholder="Alasan transfer carry…" />
        {reasonError ? <small className={styles.fieldError}>{reasonError}</small> : null}
      </label>
      <ul className={styles.warningBox}>
        <li>This moves only unused carry.</li>
        <li>Existing coverage is not changed.</li>
        <li>Original donation and Final Event remain unchanged.</li>
      </ul>
      <div className={styles.footer}>
        <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={busy || invalid}>{busy ? "Memproses…" : "Transfer Carry"}</Button>
      </div>
    </form>
  </Modal>;
}
