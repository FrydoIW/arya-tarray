"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { Select } from "@/components/ui/Select";
import { formatMoney } from "@/lib/format";
import { centsToMoney, createIdempotencyKey, dependencyConflictHint, destinationUnitRequirement, moneyToCents,
  subscriptionLabel, transferEstimate, validateTransferAmount } from "../program-allocation.utils";
import type { CarrySummarySource, CarryTransferInput, SponsorshipSubscription } from "../types";
import styles from "../styles/program-allocation.module.css";

type Props = {
  open: boolean;
  sources: CarrySummarySource[];
  destinations: SponsorshipSubscription[];
  campaigns?: Array<{ campaignId: string; campaignName: string; code: string; eventName: string }>;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSourceChange: () => void;
  onSubmit: (source: CarrySummarySource, input: CarryTransferInput) => Promise<boolean>;
};

function sourceValue(source: CarrySummarySource) {
  return `${source.sourceType}:${source.sourceSubscriptionId ?? source.sourceCampaignId}`;
}

export function TransferCarryModal({ open, sources, destinations, campaigns = [], busy, error, onClose, onSourceChange, onSubmit }: Props) {
  const [sourceId, setSourceId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const commandRef = useRef<{ key: string; payload: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const initial = sources.length === 1 ? sources[0] : null;
    setSourceId(initial ? sourceValue(initial) : "");
    setDestinationId("");
    setAmount(initial?.balance ?? "");
    setReason("");
    commandRef.current = null;
  }, [open, sources]);

  const source = useMemo(() => sources.find(item => sourceValue(item) === sourceId) ?? null, [sourceId, sources]);
  const availableDestinations = source?.sourceType === "TIME_BASED"
    ? destinations.filter(item => item.subscriptionId !== source.sourceSubscriptionId) : destinations;
  const availableCampaigns = source?.sourceType === "CAMPAIGN"
    ? campaigns.filter(item => item.campaignId !== source.sourceCampaignId) : campaigns;
  const destination = availableDestinations.find(item => item.subscriptionId === destinationId) ?? null;
  const campaign = destinationId.startsWith("campaign:")
    ? availableCampaigns.find(item => `campaign:${item.campaignId}` === destinationId) ?? null : null;
  const amountError = source ? validateTransferAmount(amount, source.balance) : "Pilih sumber carry terlebih dahulu.";
  const reasonError = reason.trim().length < 3 ? "Reason wajib diisi (minimal 3 karakter)." : null;
  const destinationError = destination || campaign ? null : "Pilih tujuan alokasi terlebih dahulu.";
  const unitRequirement = destination?.timeRule
    ? destinationUnitRequirement(amount, destination.carryBalance, destination.timeRule.unitAmount) : null;
  const unitError = unitRequirement ? `Kurang ${formatMoney(unitRequirement)} untuk mencapai 1 unit di tujuan.` : null;
  const invalid = Boolean(!source || amountError || reasonError || destinationError || unitError);
  const estimate = destination?.timeRule
    ? transferEstimate({ amount, destinationCarry: destination.carryBalance, unitAmount: destination.timeRule.unitAmount, durationMonths: destination.timeRule.durationMonths }) : null;
  const hint = error ? dependencyConflictHint(error) : null;

  function changeSource(nextId: string) {
    const next = sources.find(item => sourceValue(item) === nextId) ?? null;
    setSourceId(nextId); setDestinationId(""); setAmount(next?.balance ?? ""); setReason(""); commandRef.current = null;
    onSourceChange();
  }

  async function submit() {
    if (busy || invalid || !source || (!destination && !campaign)) return;
    const cents = moneyToCents(amount);
    if (cents === null) return;
    const normalized = centsToMoney(cents);
    const payload = JSON.stringify({ sourceType: source.sourceType, sourceSubscriptionId: source.sourceSubscriptionId,
      sourceCampaignId: source.sourceCampaignId, destinationSubscriptionId: destination?.subscriptionId,
      destinationCampaignId: campaign?.campaignId, amount: normalized, reason: reason.trim() });
    if (!commandRef.current || commandRef.current.payload !== payload)
      commandRef.current = { key: createIdempotencyKey(), payload };
    await onSubmit(source, { ...(destination ? { destinationSubscriptionId: destination.subscriptionId } : { destinationCampaignId: campaign!.campaignId }),
      amount: normalized, reason: reason.trim(), idempotencyKey: commandRef.current.key });
  }

  return <Modal open={open} title="Alokasikan Carry" description="Pilih sumber carry donatur, lalu tentukan tujuan alokasinya. Provenance sumber tetap tersimpan di ledger audit."
    onClose={() => !busy && onClose()}>
    <form className={styles.modalBody} onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label className={styles.field}>Sumber Carry
        <Select value={sourceId} disabled={busy || sources.length === 1} onChange={event => changeSource(event.target.value)} aria-label="Carry source">
          <option value="">{sources.length ? "Pilih sumber carry…" : "Belum ada carry tersedia"}</option>
          {sources.map(item => <option key={sourceValue(item)} value={sourceValue(item)}>
            {item.sourceType === "TIME_BASED" ? "TIME BASED" : "CAMPAIGN"} · {item.code} · {item.name} — {formatMoney(item.balance)}
          </option>)}
        </Select>
        {sources.length > 1 ? <small className={styles.helper}>Pilih sumber secara eksplisit agar provenance transfer tetap jelas.</small> : null}
      </label>
      {source ? <div className={styles.sourceBox}>
        <span>{source.sourceType === "TIME_BASED" ? "TIME BASED" : "CAMPAIGN"}{source.activeFlag ? "" : " · sumber historis"}</span>
        <strong>{source.code} · {source.name}</strong><small>{source.detail ?? "Tanpa referensi"}</small>
        <b>Saldo tersedia <span className={styles.money}>{formatMoney(source.balance)}</span></b>
      </div> : null}
      {error ? <div className="ui-alert ui-alert-error" role="alert">{error}{hint ? <small className={styles.hint}>{hint}</small> : null}</div> : null}
      <label className={styles.field}>Tujuan Alokasi
        <Select value={destinationId} disabled={busy || !source || (!availableDestinations.length && !availableCampaigns.length)} onChange={event => setDestinationId(event.target.value)} aria-label="Destination program">
          <option value="">Pilih tujuan…</option>
          {availableDestinations.map(item => <option key={item.subscriptionId} value={item.subscriptionId}>{item.event.code} · {item.event.eventName} — {subscriptionLabel(item)}</option>)}
          {availableCampaigns.map(item => <option key={item.campaignId} value={`campaign:${item.campaignId}`}>{item.code} · {item.eventName} — {item.campaignName}</option>)}
        </Select>
        {source && destinationError ? <small className={styles.fieldError}>{destinationError}</small> : null}
        {source && !availableDestinations.length && !availableCampaigns.length ? <small className={styles.fieldError}>Belum ada tujuan alokasi yang valid untuk sumber ini.</small> : null}
      </label>
      <label className={styles.field}>Jumlah Transfer
        <MoneyInput value={amount} disabled={busy || !source} onValueChange={setAmount} aria-label="Transfer amount" />
        <small className={styles.helper}>Default seluruh carry sumber. Partial diperbolehkan.</small>
        {source && amountError ? <small className={styles.fieldError}>{amountError}</small> : null}
      </label>
      {destination ? <div className={styles.ruleBox}>
        <span>Destination Current Rule</span><strong>{destination.timeRule ? `${formatMoney(destination.timeRule.unitAmount)} / ${destination.timeRule.durationMonths} bln` : "Tidak ada rule aktif"}</strong>
        <small>Destination carry saat ini {formatMoney(destination.carryBalance)}</small>{unitError ? <small className={styles.fieldError}>{unitError}</small> : null}
      </div> : null}
      {campaign ? <div className={styles.ruleBox}><span>Campaign tujuan</span><strong>{campaign.code} · {campaign.eventName}</strong><small>{campaign.campaignName} menerima alokasi carry tanpa membuat BankTransaction.</small></div> : null}
      {estimate ? <div className={styles.previewBox}>
        <span>Estimated Result <small>perkiraan — backend tetap otoritatif</small></span>
        <div className={styles.previewRow}><span>Generated coverage</span><b>{estimate.months > 0 ? `${estimate.units} unit · ${estimate.months} bln` : "Belum cukup untuk 1 unit"}</b></div>
        <div className={styles.previewRow}><span>Amount applied</span><b className={styles.money}>{formatMoney(estimate.amountApplied)}</b></div>
        <div className={styles.previewRow}><span>Remaining destination carry</span><b className={styles.money}>{formatMoney(estimate.remainingCarry)}</b></div>
      </div> : null}
      <label className={styles.field}>Reason
        <textarea required minLength={3} maxLength={1000} rows={3} value={reason} disabled={busy || !source} onChange={event => setReason(event.target.value)} placeholder="Alasan transfer carry…" />
        {source && reasonError ? <small className={styles.fieldError}>{reasonError}</small> : null}
      </label>
      <ul className={styles.warningBox}><li>This moves only unused carry.</li><li>Existing coverage is not changed.</li><li>Original donation and Final Event remain unchanged.</li></ul>
      <div className={styles.footer}><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={busy || invalid}>{busy ? "Memproses…" : "Alokasikan Carry"}</Button></div>
    </form>
  </Modal>;
}
