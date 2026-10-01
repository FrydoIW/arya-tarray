"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, CalendarPlus, CircleAlert, Gift } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatDate, formatMoney } from "@/lib/format";
import { invalidateWorkspaceCache } from "@/lib/workspace-cache";
import { invalidateMonitoringWorkspaces } from "@/features/monitoring/monitoring-cache";
import * as api from "../api/member-data.api";
import { moneyToCents, transferDestinationCandidates } from "../program-allocation.utils";
import type { CarrySummarySource, CarryTransferHistory, CarryTransferInput, CarryTransferRecord, CarryTransferReverseInput, OpeningCoverageInput, SponsorshipSubscription, SponsorshipWorkspace, SubscriptionInput } from "../types";
import { ContributionOverview } from "./ContributionOverview";
import { ReverseTransferModal } from "./ReverseTransferModal";
import { TimeBasedProgramCard } from "./TimeBasedProgramCard";
import { TransferCarryModal } from "./TransferCarryModal";
import { TransferHistoryPanel } from "./TransferHistoryPanel";
import styles from "../styles/program-allocation.module.css";

type FormMode = "create" | "edit" | "opening" | "void-opening" | null;
const emptySubscription: SubscriptionInput = { eventCodeId: "", referenceNo: null, displayName: null, remark: null };

function campaignPeriodLabel(startDate: string | null, endDate: string | null) {
  const date = startDate ?? endDate;
  return date
    ? new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00.000Z`))
    : "Periode terbuka";
}

function campaignStatusLabel(status: string) {
  if (status === "ACTIVE") return "AKTIF";
  if (status === "ENDED") return "SELESAI";
  if (status === "CLOSED") return "NONAKTIF";
  if (status === "SCHEDULED") return "TERJADWAL";
  return status;
}

function CampaignSection({ campaigns, canMutate, onAddCampaign }: {
  campaigns: SponsorshipWorkspace["campaigns"];
  canMutate: boolean;
  onAddCampaign: () => void;
}) {
  return <section className={styles.section} aria-labelledby="pa-campaign-title">
    <div className={styles.sectionHead}>
      <div><h2 id="pa-campaign-title">CAMPAIGN</h2><p>Partisipasi Campaign, target, dan carry donatur.</p></div>
      {campaigns.length && canMutate ? <Button size="sm" icon={<Gift size={14} />} onClick={onAddCampaign}>Tambah Campaign</Button> : null}
    </div>
    {campaigns.length ? <div className={styles.campaignGrid}>
      {campaigns.map(row => <article key={row.campaignId} className={styles.campaignCard}>
          <span className={styles.campaignIcon} aria-hidden="true"><Gift size={17} /></span>
          <div>
            <header><div><strong>{row.eventCode} · {row.eventName}</strong><small>{row.campaignName}</small></div>
              <em data-status={row.status}>{campaignStatusLabel(row.status)}</em>
            </header>
            <div className={styles.campaignFigures}>
              <span>Kontribusi langsung <b className={styles.money}>{formatMoney(row.directContribution)}</b></span>
              <span>Terpakai untuk Campaign <b className={styles.money}>{formatMoney(row.appliedToCampaign)}</b></span>
              <span>Alokasi dari Carry <b className={styles.money}>{formatMoney(row.allocatedFromCarry)}</b></span>
              <span>Saldo Carry Campaign <b className={styles.money}>{formatMoney(row.carryBalance)}</b></span>
              {row.targetAmount ? <span>Target <b className={styles.money}>{formatMoney(row.targetApplied)} / {formatMoney(row.targetAmount)}</b></span> : null}
            </div>
          </div>
        </article>)}
    </div> : <div className={styles.compactEmpty}><span aria-hidden="true"><Gift size={18} /></span><div><strong>Belum ada Campaign</strong><p>Tambahkan Campaign jika donatur ingin berpartisipasi.</p></div>{canMutate ? <Button size="sm" onClick={onAddCampaign}>Tambah Campaign</Button> : null}</div>}
  </section>;
}

function CarryDonorSummary({ summary, canAllocate, busy, onAllocate }: {
  summary: SponsorshipWorkspace["carrySummary"];
  canAllocate: boolean;
  busy: boolean;
  onAllocate: () => void;
}) {
  return <section className={styles.carrySummary} aria-labelledby="pa-carry-summary-title">
    <div><span className={styles.carrySummaryKicker}>CARRY DONATUR</span><h2 id="pa-carry-summary-title">{formatMoney(summary.total)}</h2>
      <p>TIME BASED {formatMoney(summary.timeBased)} <span>·</span> Campaign {formatMoney(summary.campaign)}</p></div>
    <div className={styles.carrySummaryAction}>
      <Button size="sm" icon={<ArrowLeftRight size={14} />} disabled={busy || !canAllocate} onClick={onAllocate}>Alokasikan Carry</Button>
      {!summary.sources.length ? <small>Belum ada Carry tersedia.</small> : !canAllocate ? <small>Belum ada tujuan alokasi yang valid.</small> : null}
    </div>
  </section>;
}

function StandardContributionSection({ contributions }: { contributions: SponsorshipWorkspace["contributions"] }) {
  const standardRows = contributions.filter(row => row.eventType === "STANDARD");

  return <section className={styles.section} aria-labelledby="pa-standard-title">
    <div className={styles.sectionHead}>
      <div><h2 id="pa-standard-title">STANDARD</h2><p>Ringkasan kontribusi langsung donor berdasarkan Final Event.</p></div>
    </div>
    {standardRows.length ? <div className={styles.standardTableWrap}>
      <table className={styles.standardTable}>
        <thead><tr><th scope="col">Final Event</th><th scope="col">Category</th><th scope="col">Transactions</th><th scope="col">Total Contribution</th></tr></thead>
        <tbody>{standardRows.map(row => <tr key={`${row.eventCodeId}:${row.campaign?.campaignId ?? "none"}`}>
          <td data-label="Final Event"><span className={styles.standardEvent}><strong>{row.eventCode}</strong><span>{row.eventName}</span></span></td>
          <td data-label="Category">{row.category}</td>
          <td data-label="Transactions" className={styles.standardNumeric}>{row.transactionCount}</td>
          <td data-label="Total Contribution" className={styles.standardNumeric}><strong className={styles.money}>{formatMoney(row.totalAmount)}</strong></td>
        </tr>)}</tbody>
      </table>
    </div> : <p className={styles.empty}>Belum ada kontribusi STANDARD</p>}
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
  const [carryModalOpen, setCarryModalOpen] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [reverseTarget, setReverseTarget] = useState<CarryTransferRecord | null>(null);
  const [reverseError, setReverseError] = useState("");
  const [campaignModalOpen, setCampaignModalOpen] = useState(false);
  const [campaignId, setCampaignId] = useState("");
  const [campaignRemark, setCampaignRemark] = useState("");
  const [campaignError, setCampaignError] = useState("");
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
    try { setData(await api.getSponsorship(memberId)); setError(""); return true; }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal memuat program & alokasi."); return false; }
    finally { if (!silent) setLoading(false); }
  }, [memberId]);
  const loadHistory = useCallback(async (silent = false) => {
    if (!silent) setHistoryLoading(true);
    try { setHistory(await api.getCarryTransfers(memberId, historyPage, historyPageSize)); setHistoryError(""); return true; }
    catch (caught) { setHistoryError(caught instanceof Error ? caught.message : "Gagal memuat riwayat transfer."); return false; }
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
      invalidateMonitoringWorkspaces(["timeBased", "campaign"]);
      setMessage(success); setMode(null); setCarryModalOpen(false); setReverseTarget(null);
      void loadHistory(true);
      return true;
    } catch (caught) { onError(caught instanceof Error ? caught.message : "Tindakan gagal."); return false; }
    finally { lock.current = false; setBusy(false); }
  }

  async function performTransferCommand(action: () => Promise<unknown>, success: string, onError: (value: string) => void) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); clearFeedback();
    try {
      await action();
      invalidateWorkspaceCache("member/data/workspace");
      invalidateMonitoringWorkspaces(["timeBased", "campaign"]);
      setCarryModalOpen(false); setReverseTarget(null);
      const [sponsorshipReloaded, historyReloaded] = await Promise.all([load(true), loadHistory(true)]);
      if (sponsorshipReloaded && historyReloaded) setMessage(success);
      else setError("Alokasi carry berhasil diproses, tetapi sebagian data gagal dimuat ulang. Silakan muat ulang halaman.");
      return true;
    } catch (caught) { onError(caught instanceof Error ? caught.message : "Tindakan gagal."); return false; }
    finally { lock.current = false; setBusy(false); }
  }

  async function submitTransfer(source: CarrySummarySource, input: CarryTransferInput) {
    if (source.sourceType === "CAMPAIGN") {
      if (!source.sourceCampaignId) return false;
      const sourceCampaignId = source.sourceCampaignId;
      return performTransferCommand(() => api.createCampaignWalletTransfer(memberId, sourceCampaignId, input),
        "Perintah alokasi carry sudah diproses. Data disegarkan.", setTransferError);
    }
    if (!source.sourceSubscriptionId) return false;
    const sourceSubscriptionId = source.sourceSubscriptionId;
    return performTransferCommand(() => api.createCarryTransfer(memberId, sourceSubscriptionId, input),
      "Perintah alokasi carry sudah diproses. Data disegarkan.", setTransferError);
  }
  async function submitReverse(input: CarryTransferReverseInput) {
    if (!reverseTarget) return false;
    return performTransferCommand(() => api.reverseCarryTransfer(memberId, reverseTarget.transferId, input),
      "Perintah pembalikan transfer sudah diproses. Data disegarkan.", setReverseError);
  }
  async function submitCampaignParticipation() {
    if (lock.current || !campaignId) return false;
    lock.current = true; setBusy(true); clearFeedback(); setCampaignError("");
    try {
      setData(await api.createCampaignParticipation(memberId, { eventCampaignId: campaignId, remark: campaignRemark.trim() || null }));
      setCampaignModalOpen(false); setMessage("Campaign ditambahkan sebagai partisipasi donatur.");
      return true;
    } catch (caught) {
      setCampaignError(caught instanceof Error ? caught.message : "Gagal menambahkan partisipasi Campaign.");
      return false;
    } finally { lock.current = false; setBusy(false); }
  }

  function editSubscription(sub: SponsorshipSubscription) {
    setSubscriptionId(sub.subscriptionId);
    setForm({ eventCodeId: sub.event.eventCodeId, referenceNo: sub.referenceNo, displayName: sub.displayName,
      remark: sub.remark });
    setFormError(""); setMode("edit");
  }

  const editedSubscription = data?.subscriptions.find(item => item.subscriptionId === subscriptionId);
  function openCreateSubscription(eventCodeId?: string) {
    const eligibleEvent = eventCodeId && data?.eventOptions.some(event => event.eventCodeId === eventCodeId)
      ? eventCodeId : data?.eventOptions[0]?.eventCodeId ?? "";
    setForm({ ...emptySubscription, eventCodeId: eligibleEvent });
    setFormError(""); setMode("create");
  }
  function openCampaignParticipation() {
    const first = data?.campaignParticipationOptions[0];
    setCampaignId(first?.campaignId ?? ""); setCampaignRemark(""); setCampaignError(""); setCampaignModalOpen(true);
  }

  const carrySources = data?.carrySummary.sources ?? [];
  const sourceHasDestination = (source: CarrySummarySource) => {
    if (!data) return false;
    const timeBasedDestinations = transferDestinationCandidates(data.subscriptions,
      source.sourceType === "TIME_BASED" ? source.sourceSubscriptionId ?? "" : "");
    const campaignDestinations = data.availableCampaigns.filter(campaign => campaign.campaignId !== source.sourceCampaignId);
    return timeBasedDestinations.length > 0 || campaignDestinations.length > 0;
  };
  const canAllocateCarry = canMutate && memberActive && carrySources.some(sourceHasDestination);

  if (loading && !data) return <section className={styles.section}><p className={styles.empty}>Memuat Program &amp; Allocation…</p></section>;

  return <div className={styles.stack}>
    {message ? <div className="ui-alert ui-alert-success" role="status">{message}</div> : null}
    {error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}

    {data ? <>
      <ContributionOverview totals={data.contributionTotals} />
      <CarryDonorSummary summary={data.carrySummary} canAllocate={canAllocateCarry} busy={busy}
        onAllocate={() => { setTransferError(""); setCarryModalOpen(true); }} />

      <StandardContributionSection contributions={data.contributions} />

      <section className={styles.section} aria-labelledby="pa-programs-title">
        <div className={styles.sectionHead}>
          <div><h2 id="pa-programs-title">TIME BASED</h2><p>Coverage, carry, dan riwayat alokasi program donatur.</p></div>
          {canMutate && data.subscriptions.length ? <Button size="sm" icon={<CalendarPlus size={14} />} disabled={loading || busy || !memberActive || !data.eventOptions.length} onClick={() => openCreateSubscription()}>Tambah Program</Button> : null}
        </div>
        {canMutate && !memberActive ? <p className={styles.notice}>Aktifkan donatur sebelum menambah program.</p>
          : canMutate && !loading && data.eventOptions.length === 0 ? <p className={styles.notice}>Siapkan Event Code TIME BASED aktif beserta Time Rule terlebih dahulu.</p> : null}
        {data.subscriptions.length ? <div className={styles.programGrid}>
          {data.subscriptions.map(sub => <TimeBasedProgramCard key={sub.subscriptionId} subscription={sub} canMutate={canMutate} busy={busy}
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

      <CampaignSection campaigns={data.campaigns} canMutate={canMutate && memberActive} onAddCampaign={openCampaignParticipation} />

      <TransferHistoryPanel history={history} loading={historyLoading} error={historyError} canMutate={canMutate} busy={busy}
        onReverse={row => { setReverseError(""); setReverseTarget(row); }}
        onPageChange={page => setHistoryPage(page)} onPageSizeChange={size => { setHistoryPageSize(size); setHistoryPage(1); }}
        onRefresh={() => void loadHistory()} />
    </> : null}

    <TransferCarryModal open={carryModalOpen} sources={carrySources} busy={busy} error={transferError}
      destinations={data ? transferDestinationCandidates(data.subscriptions, "") : []}
      campaigns={data?.availableCampaigns ?? []}
      onClose={() => !busy && setCarryModalOpen(false)} onSourceChange={() => setTransferError("")} onSubmit={submitTransfer} />
    <ReverseTransferModal open={Boolean(reverseTarget)} transfer={reverseTarget} busy={busy} error={reverseError}
      onClose={() => !busy && setReverseTarget(null)} onSubmit={submitReverse} />

    <Modal open={campaignModalOpen} title="Tambah Campaign"
      description="Tambahkan partisipasi donatur. Ini tidak membuat transaksi bank atau alokasi dana."
      onClose={() => { if (!busy) setCampaignModalOpen(false); }}>
      <form className={styles.modalBody} onSubmit={event => { event.preventDefault(); void submitCampaignParticipation(); }}>
        {campaignError ? <div className="ui-alert ui-alert-error" role="alert">{campaignError}</div> : null}
        <label className={styles.field}>Campaign
          <select required value={campaignId} disabled={busy || !data?.campaignParticipationOptions.length} onChange={event => setCampaignId(event.target.value)}>
            {!campaignId ? <option value="" disabled>Pilih Campaign</option> : null}
            {data?.campaignParticipationOptions.map(option => <option key={option.campaignId} value={option.campaignId}>
              {option.code} · {option.campaignName} — {campaignPeriodLabel(option.startDate, option.endDate)}
            </option>)}
          </select>
          {!data?.campaignParticipationOptions.length ? <small className={styles.helper}>Belum ada Campaign aktif yang dapat diikuti saat ini.</small> : null}
        </label>
        <label className={styles.field}>Catatan <span className={styles.helper}>Opsional</span>
          <textarea rows={3} maxLength={1000} value={campaignRemark} disabled={busy}
            onChange={event => setCampaignRemark(event.target.value)} />
          <small className={styles.helper}>Dana masuk, kontribusi, dan carry tetap tidak berubah.</small>
        </label>
        <div className={styles.footer}>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setCampaignModalOpen(false)}>Batal</Button>
          <Button type="submit" disabled={busy || !campaignId}>{busy ? "Menambahkan…" : "Tambah"}</Button>
        </div>
      </form>
    </Modal>

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
            <span className={styles.readOnlyValue}>{mode === "edit" ? (editedSubscription?.startDate ? formatDate(editedSubscription.startDate) : "—") : "—"}</span>
            <small className={styles.helper}>{mode === "edit" ? "Dikelola otomatis dari riwayat pembayaran dan coverage aktif." : "Akan ditetapkan dari pembayaran pertama atau Opening Coverage."}</small></label>
          <div className={styles.statusField}>
            <span className={styles.statusLabel}>Status Program</span>
            <div className={styles.statusReadOnly}><span className={styles.statusPill} data-status={mode === "create" ? "ACTIVE" : editedSubscription?.status ?? "INACTIVE"}>{mode === "create" || editedSubscription?.activeFlag ? "Aktif" : "Nonaktif"}</span><small>Dikelola otomatis oleh sistem.</small></div>
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
