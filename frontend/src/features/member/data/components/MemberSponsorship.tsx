"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatDate, formatMoney } from "@/lib/format";
import * as api from "../api/member-data.api";
import type { OpeningCoverageInput, SponsorshipWorkspace, SubscriptionInput } from "../types";
import styles from "../styles/member-data.module.css";

type FormMode = "create" | "edit" | "opening" | null;
const emptySubscription: SubscriptionInput = { eventCodeId: "", referenceNo: null, displayName: null, startDate: null, activeFlag: true, remark: null };

export function MemberSponsorship({ memberId, canMutate }: { memberId: string; canMutate: boolean }) {
  const [data, setData] = useState<SponsorshipWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<FormMode>(null);
  const [subscriptionId, setSubscriptionId] = useState("");
  const [form, setForm] = useState<SubscriptionInput>(emptySubscription);
  const [opening, setOpening] = useState<OpeningCoverageInput>({ coverageFrom: "", coverageTo: "", remark: "" });
  const editedSubscription = data?.subscriptions.find(item => item.subscriptionId === subscriptionId);
  const startLocked = mode === "edit" && Boolean(editedSubscription?.coverage.length || editedSubscription?.balanceHistory.length);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.getSponsorship(memberId)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load sponsorship."); }
    finally { setLoading(false); }
  }, [memberId]);
  useEffect(() => { void load(); }, [load]);

  async function perform(action: () => Promise<SponsorshipWorkspace>) {
    setBusy(true);
    setError("");
    try { setData(await action()); setMode(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Sponsorship action failed."); }
    finally { setBusy(false); }
  }
  function edit(id: string) {
    const sub = data?.subscriptions.find(item => item.subscriptionId === id);
    if (!sub) return;
    setSubscriptionId(id);
    setForm({ eventCodeId: sub.event.eventCodeId, referenceNo: sub.referenceNo, displayName: sub.displayName,
      startDate: sub.startDate, activeFlag: sub.activeFlag, remark: sub.remark });
    setMode("edit");
  }

  return <section className={styles.detailPanel}>
    <div className={styles.sectionHead}>
      <div><h2>Rupang &amp; Program</h2><p>Subscription and coverage ledger. Payment allocation never changes financial approval.</p></div>
      {canMutate ? <Button size="sm" disabled={loading || !data?.eventOptions.length} onClick={() => {
        setForm({ ...emptySubscription, eventCodeId: data?.eventOptions[0]?.eventCodeId ?? "" });
        setMode("create");
      }}>Add subscription</Button> : null}
    </div>
    {canMutate && !loading && data && data.eventOptions.length === 0 ? <p className={styles.optionState}>Configure an active Time-Based Event Code and Time Rule first.</p> : null}
    {error ? <div className="ui-alert ui-alert-error">{error}</div> : null}
    {loading ? <p className={styles.optionState}>Loading sponsorship…</p> : <div className={styles.sponsorshipStack}>
      {data?.subscriptions.length ? data.subscriptions.map(sub => <article className={styles.sponsorshipCard} key={sub.subscriptionId}>
        <header><div><strong>{sub.event.code} · {sub.event.eventName}</strong><small>{sub.referenceNo || "No reference"}{sub.displayName ? ` · ${sub.displayName}` : ""}</small></div><span>{sub.status}</span></header>
        <div className={styles.sponsorshipMeta}>
          <span>Start <b>{sub.startDate ? formatDate(sub.startDate) : "Payment date"}</b></span>
          <span>Valid until <b>{sub.validUntil ? formatDate(sub.validUntil) : "—"}</b></span>
          <span>Rate <b>{sub.timeRule ? `${formatMoney(sub.timeRule.unitAmount)} / ${sub.timeRule.durationMonths} month` : "Historical"}</b></span>
          <span>Carry balance <b>{formatMoney(sub.carryBalance)}</b></span>
        </div>
        {canMutate ? <div className={styles.compactActions}>
          <Button size="sm" variant="ghost" onClick={() => edit(sub.subscriptionId)}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => { setSubscriptionId(sub.subscriptionId); setOpening({ coverageFrom: "", coverageTo: "", remark: "" }); setMode("opening"); }}>Opening coverage</Button>
        </div> : null}
        <div className={styles.coverageList}>{sub.coverage.length ? sub.coverage.map(coverage => <div key={coverage.coverageId}>
          <strong>{coverage.source === "OPENING" ? "Opening coverage" : `+${(coverage.grantedUnits ?? 0) * (coverage.durationMonths ?? 0)} months`}</strong>
          <span>{formatDate(coverage.coverageFrom)} → {formatDate(coverage.coverageTo)}</span>
          <small>{coverage.amountApplied ? formatMoney(coverage.amountApplied) : "No transaction"} · {coverage.status}{coverage.voidReason ? ` · ${coverage.voidReason}` : ""}</small>
        </div>) : <small>No coverage recorded.</small>}</div>
        {sub.balanceHistory.length ? <div className={styles.coverageList} aria-label="Balance history">
          {sub.balanceHistory.map(entry => <div key={entry.ledgerId}>
            <strong>{entry.type === "PAYMENT" ? "Payment" : "Coverage use"} · {entry.amountDelta.startsWith("-") ? "-" : "+"}{formatMoney(entry.amountDelta.replace("-", ""))}</strong>
            <span>{entry.effectiveDate ? formatDate(entry.effectiveDate) : "—"}{entry.referenceNo ? ` · ${entry.referenceNo}` : ""}</span>
            <small>{entry.status}{entry.voidReason ? ` · ${entry.voidReason}` : ""}</small>
          </div>)}
        </div> : null}
      </article>) : <p className={styles.optionState}>No sponsorship subscription yet.</p>}

      {data?.pendingPayments.length ? <article className={styles.pendingPayments}><h3>Pending Time-Based payments</h3>
        {data.pendingPayments.map(payment => {
          const compatible = data.subscriptions.filter(sub => sub.activeFlag && sub.event.eventCodeId === payment.event?.eventCodeId);
          return <div key={payment.transactionId}>
            <div><strong>{payment.event ? `${payment.event.code} · ${payment.event.eventName}` : "Time-Based payment"}</strong>
              <small>{payment.transactionDate ? formatDate(payment.transactionDate) : "—"} · {formatMoney(payment.amount)} · {payment.grantedUnits !== null
                ? `${payment.unitAmount ? `${formatMoney(payment.unitAmount)} / unit · ` : ""}${payment.grantedUnits * (payment.durationMonths ?? 0)} months from payment alone`
                : "Rule needs attention"}</small>
              <em>{compatible.length === 0 ? "No compatible active subscription. Create a subscription first." : payment.reason}</em>
            </div>
            {canMutate && compatible.length > 1 ? <select aria-label="Allocate payment" defaultValue="" disabled={busy} onChange={event => {
              if (event.target.value) void perform(() => api.allocateSponsorshipPayment(memberId, event.target.value, payment.transactionId));
            }}><option value="">Allocate to…</option>{compatible.map(sub => <option key={sub.subscriptionId} value={sub.subscriptionId}>{sub.referenceNo || sub.displayName || sub.subscriptionId}</option>)}</select> : null}
          </div>;
        })}
      </article> : null}
    </div>}

    <Modal open={mode === "create" || mode === "edit"} title={mode === "create" ? "Add Rupang subscription" : "Edit Rupang subscription"}
      description="Subscription metadata only; coverage remains in its audit ledger." onClose={() => !busy && setMode(null)}>
      <form className={styles.modalBody} onSubmit={event => {
        event.preventDefault();
        if (mode === "create") void perform(() => api.createSubscription(memberId, form));
        else void perform(() => api.updateSubscription(memberId, subscriptionId, { referenceNo: form.referenceNo, displayName: form.displayName,
          startDate: form.startDate, activeFlag: form.activeFlag, remark: form.remark }));
      }}>
        <div className={styles.formGrid}>
          <label className={styles.field}>Program<select value={form.eventCodeId} disabled={busy || mode === "edit"} onChange={event => setForm(value => ({ ...value, eventCodeId: event.target.value }))}>
            {mode === "edit" && editedSubscription && !data?.eventOptions.some(item => item.eventCodeId === editedSubscription.event.eventCodeId)
              ? <option value={editedSubscription.event.eventCodeId}>{editedSubscription.event.code} · {editedSubscription.event.eventName} (historical)</option> : null}
            {data?.eventOptions.map(item => <option key={item.eventCodeId} value={item.eventCodeId}>{item.code} · {item.eventName}</option>)}
          </select></label>
          <label className={styles.field}>Reference<input value={form.referenceNo ?? ""} maxLength={100} onChange={event => setForm(value => ({ ...value, referenceNo: event.target.value || null }))} /></label>
          <label className={styles.field}>Display name<input value={form.displayName ?? ""} maxLength={200} onChange={event => setForm(value => ({ ...value, displayName: event.target.value || null }))} /></label>
          <label className={styles.field}>Start date<input type="date" value={form.startDate ?? ""} disabled={busy || startLocked} onChange={event => setForm(value => ({ ...value, startDate: event.target.value || null }))} />
            {startLocked ? <small>Start date is locked after coverage or payment history exists.</small> : null}</label>
        </div>
        <label className={styles.toggle}><input type="checkbox" checked={form.activeFlag} onChange={event => setForm(value => ({ ...value, activeFlag: event.target.checked }))} /><span>Active subscription</span></label>
        <label className={styles.field}>Remark<textarea value={form.remark ?? ""} onChange={event => setForm(value => ({ ...value, remark: event.target.value || null }))} /></label>
        <div className={styles.footer}><Button type="button" variant="secondary" disabled={busy} onClick={() => setMode(null)}>Cancel</Button><Button type="submit" disabled={busy || !form.eventCodeId}>{busy ? "Saving…" : "Save"}</Button></div>
      </form>
    </Modal>

    <Modal open={mode === "opening"} title="Add opening coverage" description="For known legacy coverage without a BankTransaction." onClose={() => !busy && setMode(null)}>
      <form className={styles.modalBody} onSubmit={event => { event.preventDefault(); void perform(() => api.addOpeningCoverage(memberId, subscriptionId, opening)); }}>
        <div className={styles.formGrid}>
          <label className={styles.field}>Coverage from<input required type="date" value={opening.coverageFrom} onChange={event => setOpening(value => ({ ...value, coverageFrom: event.target.value }))} /></label>
          <label className={styles.field}>Coverage to<input required type="date" value={opening.coverageTo} onChange={event => setOpening(value => ({ ...value, coverageTo: event.target.value }))} /></label>
        </div>
        <label className={styles.field}>Reason<textarea required minLength={3} value={opening.remark} onChange={event => setOpening(value => ({ ...value, remark: event.target.value }))} /></label>
        <div className={styles.footer}><Button type="button" variant="secondary" disabled={busy} onClick={() => setMode(null)}>Cancel</Button><Button type="submit" disabled={busy}>Add coverage</Button></div>
      </form>
    </Modal>
  </section>;
}
