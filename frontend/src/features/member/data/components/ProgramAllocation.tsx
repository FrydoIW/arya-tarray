"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarPlus, CircleAlert, Gift } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatDate, formatMoney } from "@/lib/format";
import { invalidateWorkspaceCache } from "@/lib/workspace-cache";
import * as api from "../api/member-data.api";
import { moneyToCents, transferDestinationCandidates } from "../program-allocation.utils";
import type { CarryTransferHistory, CarryTransferInput, CarryTransferRecord, CarryTransferReverseInput, OpeningCoverageInput, SponsorshipSubscription, SponsorshipWorkspace, SubscriptionInput } from "../types";
import { ContributionOverview } from "./ContributionOverview";
import { ReverseTransferModal } from "./ReverseTransferModal";
import { TimeBasedProgramCard } from "./TimeBasedProgramCard";
import { TransferCarryModal } from "./TransferCarryModal";
import { TransferHistoryPanel } from "./TransferHistoryPanel";
import styles from "../styles/program-allocation.module.css";

type FormMode = "create" | "edit" | "opening" | "void-opening" | null;
const emptySubscription: SubscriptionInput = { eventCodeId: "", referenceNo: null, displayName: null, startDate: null, activeFlag: true, remark: null };

function CampaignSection({ campaigns, canMutate, hasCarry, canAllocate, onAllocate }: { campaigns: SponsorshipWorkspace["campaigns"]; canMutate: boolean; hasCarry: boolean; canAllocate: boolean; onAllocate: () => void }) {
  return <section className={styles.section} aria-labelledby="pa-campaign-title">
    <div className={styles.sectionHead}>
      <div><h2 id="pa-campaign-title">CAMPAIGN</h2><p>Partisipasi Campaign dan alokasi carry donatur.</p></div>
      {canMutate && canAllocate && hasCarry ? <Button size="sm" icon={<Gift size={14} />} onClick={onAllocate}>Alokasikan Carry</Button> : null}
    </div>
    {campaigns.length ? <div className={styles.campaignGrid}>
      {campaigns.map(row => <article key={row.campaignId} className={styles.campaignCard}>
        <span className={styles.campaignIcon} aria-hidden="true"><Gift size={17} /></span>
        <div>
          <header><div><strong>{row.eventCode} · {row.eventName}</strong><small>{row.campaignName}</small></div>
            <em data-status={row.status}>{row.status}</em>
          </header>
          <footer><span>Langsung {formatMoney(row.directContribution)} · Carry {formatMoney(row.allocatedFromCarry)}</span><strong className={styles.money}>{formatMoney(row.totalAllocation)}</strong></footer>
        </div>
      </article>)}
    </div> : <div className={styles.compactEmpty}><span aria-hidden="true"><Gift size={18} /></span><div><strong>Belum ada alokasi Campaign</strong><p>Campaign aktif dapat menerima alokasi carry tanpa membuat transaksi bank baru.</p></div>{canMutate && canAllocate && hasCarry ? <Button size="sm" onClick={onAllocate}>Tambah Campaign</Button> : null}</div>}
  </section>;
}

export function ProgramAllocation({ memberId, memberActive, canMutate }: { memberId: string; memberActive: boolean; canMutate: boolean }) {
  const [data, setData] = useState<SponsorshipWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<CarryTransferHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const [transferSource, setTransferSource] = useState<SponsorshipSubscription | null>(null);
  const [transferError, setTransferError] = useState("");
  const [reverseTarget, setReverseTarget] = useState<CarryTransferRecord | null>(null);
  const [reverseError, setReverseError] = useState("");
  const [mode, setMode] = useState<FormMode>(null);
  const [subscriptionId, setSubscriptionId] = useState("");
  const [coverageId, setCoverageId] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState<SubscriptionInput>(emptySubscription);
  const [opening, setOpening] = useState<OpeningCoverageInput>({ coverageFrom: "", coverageTo: "", remark: "" });
  const lock = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try { setData(await api.getSponsorship(memberId)); setError(""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal memuat program & alokasi."); }
    finally { if (!silent) setLoading(false); }
  }, [memberId]);
  const loadHistory = useCallback(async (silent = false) => {
    if (!silent) setHistoryLoading(true);
    try { setHistory(await api.getCarryTransfers(memberId, historyPage, historyPageSize)); setHistoryError(""); }
    catch (caught) { setHistoryError(caught instanceof Error ? caught.message : "Gagal memuat riwayat transfer."); }
    finally { if (!silent) setHistoryLoading(false); }
  }, [memberId, historyPage, historyPageSize]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  function clearFeedback() { setError(""); setMessage(""); }

  async function performSponsorship(action: () => Promise<SponsorshipWorkspace>, success: string, onError: (value: string) => void) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); clearFeedback();
    try {
      setData(await action());
      invalidateWorkspaceCache("member/data/workspace");
      invalidateWorkspaceCache("monitoring/dashboard/workspace");
      setMessage(success); setMode(null); setTransferSource(null); setReverseTarget(null);
      void loadHistory(true);
      return true;
    } catch (caught) { onError(caught instanceof Error ? caught.message : "Tindakan gagal."); return false; }
    finally { lock.current = false; setBusy(false); }
  }

  async function performTransferCommand(action: () => Promise<{ replayed: boolean }>, success: string, replayedMessage: string, onError: (value: string) => void) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); clearFeedback();
    try {
      const result = await action();
      invalidateWorkspaceCache("member/data/workspace");
      invalidateWorkspaceCache("monitoring/dashboard/workspace");
      setMessage(result.replayed ? replayedMessage : success);
      setTransferSource(null); setReverseTarget(null);
      await Promise.all([load(true), loadHistory(true)]);
      return true;
    } catch (caught) { onError(caught instanceof Error ? caught.message : "Tindakan gagal."); return false; }
    finally { lock.current = false; setBusy(false); }
  }

  async function submitTransfer(input: CarryTransferInput) {
    if (!transferSource) return false;
    return performTransferCommand(() => api.createCarryTransfer(memberId, transferSource.subscriptionId, input),
      "Transfer carry berhasil diproses.", "Transfer carry sudah pernah diproses. Data disegarkan.", setTransferError);
  }
  async function submitReverse(input: CarryTransferReverseInput) {
    if (!reverseTarget) return false;
    return performTransferCommand(() => api.reverseCarryTransfer(memberId, reverseTarget.transferId, input),
      "Transfer berhasil dibalikkan.", "Pembalikan transfer sudah pernah diproses. Data disegarkan.", setReverseError);
  }

  function editSubscription(sub: SponsorshipSubscription) {
    setSubscriptionId(sub.subscriptionId);
    setForm({ eventCodeId: sub.event.eventCodeId, referenceNo: sub.referenceNo, displayName: sub.displayName,
      startDate: sub.startDate, activeFlag: sub.activeFlag, remark: sub.remark });
    setFormError(""); setMode("edit");
  }

  const editedSubscription = data?.subscriptions.find(item => item.subscriptionId === subscriptionId);
  function openCreateSubscription(eventCodeId?: string) {
    const eligibleEvent = eventCodeId && data?.eventOptions.some(event => event.eventCodeId === eventCodeId)
      ? eventCodeId : data?.eventOptions[0]?.eventCodeId ?? "";
    setForm({ ...emptySubscription, eventCodeId: eligibleEvent });
    setFormError(""); setMode("create");
  }
  function openCampaignAllocation() {
    const source = data?.subscriptions.find(item => item.activeFlag && moneyToCents(item.carryBalance)! > BigInt(0)) ?? null;
    if (!source) return;
    setTransferError(""); setTransferSource(source);
  }

  if (loading && !data) return <section className={styles.section}><p className={styles.empty}>Memuat Program &amp; Allocation…</p></section>;

  return <div className={styles.stack}>
    {message ? <div className="ui-alert ui-alert-success" role="status">{message}</div> : null}
    {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}

    {data ? <>
      <ContributionOverview totals={data.contributionTotals} />

      <section className={styles.section} aria-labelledby="pa-programs-title">
        <div className={styles.sectionHead}>
          <div><h2 id="pa-programs-title">TIME BASED</h2><p>Coverage, carry, dan riwayat alokasi program donatur.</p></div>
          {canMutate && data.subscriptions.length ? <Button size="sm" icon={<CalendarPlus size={14} />} disabled={loading || busy || !memberActive || !data.eventOptions.length} onClick={() => openCreateSubscription()}>Tambah Program</Button> : null}
        </div>
        {canMutate && !memberActive ? <p className={styles.notice}>Aktifkan donatur sebelum menambah program.</p>
          : canMutate && !loading && data.eventOptions.length === 0 ? <p className={styles.notice}>Siapkan Event Code TIME BASED aktif beserta Time Rule terlebih dahulu.</p> : null}
        {data.subscriptions.length ? <div className={styles.programGrid}>
          {data.subscriptions.map(sub => <TimeBasedProgramCard key={sub.subscriptionId} subscription={sub} canMutate={canMutate}
            memberActive={memberActive} busy={busy} hasCampaignDestinations={Boolean(data.availableCampaigns.length)} destinations={transferDestinationCandidates(data.subscriptions, sub.subscriptionId)}
            onTransfer={subSource => { setTransferError(""); setTransferSource(subSource); }}
            onEdit={editSubscription}
            onOpeningCoverage={subSource => { setSubscriptionId(subSource.subscriptionId); setOpening({ coverageFrom: "", coverageTo: "", remark: "" }); setFormError(""); setMode("opening"); }}
            onVoidOpening={(subSource, targetCoverageId) => { setSubscriptionId(subSource.subscriptionId); setCoverageId(targetCoverageId); setVoidReason(""); setFormError(""); setMode("void-opening"); }} />)}
        </div> : <div className={styles.compactEmpty}>
          <span aria-hidden="true"><CalendarPlus size={18} /></span>
          <div><strong>Belum ada program TIME BASED</strong><p>Tambahkan program untuk mulai mengelola coverage dan carry.</p></div>
          {canMutate ? <Button size="sm" disabled={loading || busy || !memberActive || !data.eventOptions.length} onClick={() => openCreateSubscription()}>Tambah Program</Button> : null}
        </div>}
      </section>

      {data.pendingPayments.length ? <section className={styles.section} aria-labelledby="pa-attention-title">
        <div className={styles.sectionHead}><div><h2 id="pa-attention-title">Perlu Tindakan</h2><p>Pembayaran TIME BASED yang belum dapat diselesaikan alokasinya.</p></div></div>
        <div className={styles.attentionList}>
          {data.pendingPayments.map(payment => {
            const compatible = data.subscriptions.filter(sub => sub.activeFlag && sub.event.eventCodeId === payment.event?.eventCodeId);
            return <article key={payment.transactionId} className={styles.attentionRow}>
              <span className={styles.attentionIcon} aria-hidden="true"><CircleAlert size={18} /></span>
              <div className={styles.attentionDetail}>
                <strong>{payment.event ? `${payment.event.code} · ${payment.event.eventName}` : "Time-Based payment"}</strong>
                <div className={styles.attentionFacts}>
                  <span>{formatDate(payment.transactionDate)}</span><span>Dana masuk {formatMoney(payment.principalAmount)}</span>
                  <span>{payment.unitAmount && payment.durationMonths ? `${formatMoney(payment.unitAmount)} / unit · ${payment.durationMonths} bulan` : "Rule perlu perhatian"}</span>
                </div>
                <p>{compatible.length === 0 ? "Belum ada program aktif yang kompatibel." : payment.reason}</p>
              </div>
              <div className={styles.attentionAction}>
              {canMutate && compatible.length === 0 ? <Button size="sm" disabled={busy || !memberActive || !data.eventOptions.some(event => event.eventCodeId === payment.event?.eventCodeId)}
                onClick={() => openCreateSubscription(payment.event?.eventCodeId)}>Buat Program</Button> : null}
              {canMutate && compatible.length === 1 ? <Button size="sm" variant="secondary" disabled={busy || payment.grantedUnits === null}
                onClick={() => void performSponsorship(() => api.retryAllocation(memberId, compatible[0].subscriptionId, payment.transactionId), "Retry Allocation berhasil.", setError)}>Retry Allocation</Button> : null}
              {canMutate && compatible.length > 1 ? <select aria-label="Allocate payment" defaultValue="" disabled={busy || payment.grantedUnits === null}
                onChange={event => { if (event.target.value) void performSponsorship(() => api.allocateSponsorshipPayment(memberId, event.target.value, payment.transactionId), "Pembayaran teralokasi.", setError); }}>
                <option value="">Allocate to…</option>{compatible.map(sub => <option key={sub.subscriptionId} value={sub.subscriptionId}>{sub.referenceNo || sub.displayName || sub.subscriptionId}</option>)}
              </select> : null}</div>
            </article>;
          })}
        </div>
      </section> : null}

      <CampaignSection campaigns={data.campaigns} canMutate={canMutate && memberActive} hasCarry={data.subscriptions.some(item => item.activeFlag && moneyToCents(item.carryBalance)! > BigInt(0))} canAllocate={Boolean(data.availableCampaigns.length)} onAllocate={openCampaignAllocation} />

      <TransferHistoryPanel history={history} loading={historyLoading} error={historyError} canMutate={canMutate} busy={busy}
        onReverse={row => { setReverseError(""); setReverseTarget(row); }}
        onPageChange={page => setHistoryPage(page)} onPageSizeChange={size => { setHistoryPageSize(size); setHistoryPage(1); }}
        onRefresh={() => void loadHistory()} />
    </> : null}

    <TransferCarryModal open={Boolean(transferSource)} source={transferSource} busy={busy} error={transferError}
      destinations={transferSource && data ? transferDestinationCandidates(data.subscriptions, transferSource.subscriptionId) : []}
      campaigns={data?.availableCampaigns ?? []}
      onClose={() => !busy && setTransferSource(null)} onSubmit={submitTransfer} />
    <ReverseTransferModal open={Boolean(reverseTarget)} transfer={reverseTarget} busy={busy} error={reverseError}
      onClose={() => !busy && setReverseTarget(null)} onSubmit={submitReverse} />

    <Modal open={mode === "create" || mode === "edit"} title={mode === "create" ? "Tambah Program" : "Edit Program"}
      description={mode === "create" ? "Tambahkan metadata program. Coverage dan ledger tersimpan sebagai audit." : "Perbarui metadata program. Riwayat coverage dan ledger tetap tersimpan sebagai audit."} onClose={() => !busy && setMode(null)}>
      <form className={`${styles.modalBody} ${styles.subscriptionModalBody}`} onSubmit={event => {
        event.preventDefault();
        if (mode === "create") void performSponsorship(() => api.createSubscription(memberId, form), "Program ditambahkan.", setFormError);
        else void performSponsorship(() => api.updateSubscription(memberId, subscriptionId, { referenceNo: form.referenceNo, displayName: form.displayName,
          remark: form.remark }), "Program diperbarui.", setFormError);
      }}>
        {formError ? <div className="ui-alert ui-alert-error" role="alert">{formError}</div> : null}
        <label className={`${styles.field} ${mode === "edit" ? styles.readOnlyField : ""}`}>Program<select value={form.eventCodeId} disabled={busy || mode === "edit"} onChange={event => setForm(value => ({ ...value, eventCodeId: event.target.value }))}>
            {mode === "edit" && editedSubscription && !data?.eventOptions.some(item => item.eventCodeId === editedSubscription.event.eventCodeId)
              ? <option value={editedSubscription.event.eventCodeId}>{editedSubscription.event.code} · {editedSubscription.event.eventName} (historis)</option> : null}
            {data?.eventOptions.map(item => <option key={item.eventCodeId} value={item.eventCodeId}>{item.code} · {item.eventName}</option>)}
          </select>{mode === "edit" ? <small className={styles.helper}>Program tidak dapat diubah setelah dibuat.</small> : null}</label>
        <div className={styles.subscriptionFormGrid}>
          <label className={styles.field}>Nama Tampilan<input value={form.displayName ?? ""} maxLength={200} onChange={event => setForm(value => ({ ...value, displayName: event.target.value || null }))} /></label>
          <label className={styles.field}>Referensi<input value={form.referenceNo ?? ""} maxLength={100} onChange={event => setForm(value => ({ ...value, referenceNo: event.target.value || null }))} /></label>
          <label className={styles.field}>Tanggal Mulai
            {mode === "edit" ? <span className={styles.readOnlyValue}>{form.startDate ? formatDate(form.startDate) : "—"}</span>
              : <input type="date" value={form.startDate ?? ""} disabled={busy} onChange={event => setForm(value => ({ ...value, startDate: event.target.value || null }))} />}
            {mode === "edit" ? <small className={styles.helper}>Dikelola otomatis dari riwayat pembayaran dan coverage aktif.</small> : null}</label>
          <div className={styles.statusField}>
            <span className={styles.statusLabel}>Status Program</span>
            <div className={styles.statusReadOnly}><span className={styles.statusPill} data-status={editedSubscription?.status ?? "ACTIVE"}>{editedSubscription?.activeFlag ? "Aktif" : "Nonaktif"}</span><small>Dikelola otomatis oleh sistem.</small></div>
          </div>
        </div>
        <label className={styles.field}>Catatan<textarea rows={3} maxLength={1000} value={form.remark ?? ""} onChange={event => setForm(value => ({ ...value, remark: event.target.value || null }))} /></label>
        <div className={styles.footer}><Button type="button" variant="secondary" disabled={busy} onClick={() => setMode(null)}>Batal</Button>
          <Button type="submit" disabled={busy || !form.eventCodeId}>{busy ? "Menyimpan…" : "Simpan"}</Button></div>
      </form>
    </Modal>

    <Modal open={mode === "opening"} title="Tambah opening coverage" description="Untuk coverage lama yang tidak memiliki BankTransaction."
      onClose={() => !busy && setMode(null)}>
      <form className={styles.modalBody} onSubmit={event => { event.preventDefault(); void performSponsorship(() => api.addOpeningCoverage(memberId, subscriptionId, opening), "Opening coverage ditambahkan.", setFormError); }}>
        {formError ? <div className="ui-alert ui-alert-error" role="alert">{formError}</div> : null}
        <div className={styles.formGrid}>
          <label className={styles.field}>Coverage from<input required type="date" value={opening.coverageFrom} onChange={event => setOpening(value => ({ ...value, coverageFrom: event.target.value }))} /></label>
          <label className={styles.field}>Coverage to<input required type="date" value={opening.coverageTo} onChange={event => setOpening(value => ({ ...value, coverageTo: event.target.value }))} /></label>
        </div>
        <label className={styles.field}>Reason<textarea required minLength={3} maxLength={1000} rows={3} value={opening.remark} onChange={event => setOpening(value => ({ ...value, remark: event.target.value }))} /></label>
        <div className={styles.footer}><Button type="button" variant="secondary" disabled={busy} onClick={() => setMode(null)}>Cancel</Button>
          <Button type="submit" disabled={busy}>Tambah coverage</Button></div>
      </form>
    </Modal>

    <Modal open={mode === "void-opening"} title="Void opening coverage?"
      description="Opening tetap tersimpan di audit. Coverage pembayaran dan valid until akan direbuild; lalu tambahkan opening koreksi." onClose={() => !busy && setMode(null)}>
      <form className={styles.modalBody} onSubmit={event => {
        event.preventDefault();
        if (voidReason.trim().length >= 3) void performSponsorship(() => api.voidOpeningCoverage(memberId, subscriptionId, coverageId, voidReason.trim()), "Opening coverage di-void.", setFormError);
      }}>
        {formError ? <div className="ui-alert ui-alert-error" role="alert">{formError}</div> : null}
        <label className={styles.field}>Reason<textarea required minLength={3} maxLength={1000} rows={3} disabled={busy} value={voidReason} onChange={event => setVoidReason(event.target.value)} /></label>
        <div className={styles.footer}><Button type="button" variant="secondary" disabled={busy} onClick={() => setMode(null)}>Cancel</Button>
          <Button type="submit" variant="danger" disabled={busy || voidReason.trim().length < 3}>{busy ? "Memproses…" : "Void opening"}</Button></div>
      </form>
    </Modal>
  </div>;
}
