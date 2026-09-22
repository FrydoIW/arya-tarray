"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BookOpenText, CalendarDays, CalendarPlus, Landmark, Pencil, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatDate, formatMoney } from "@/lib/format";
import { canOfferTransfer, coverageSourceLabel, ledgerEntryKind, ledgerEntryLabel } from "../program-allocation.utils";
import type { SponsorshipSubscription } from "../types";
import styles from "../styles/program-allocation.module.css";

type CardProps = {
  subscription: SponsorshipSubscription;
  canMutate: boolean;
  memberActive: boolean;
  destinations: SponsorshipSubscription[];
  busy: boolean;
  onTransfer: (subscription: SponsorshipSubscription) => void;
  onEdit: (subscription: SponsorshipSubscription) => void;
  onOpeningCoverage: (subscription: SponsorshipSubscription) => void;
  onVoidOpening: (subscription: SponsorshipSubscription, coverageId: string) => void;
};

function signedMoney(value: string) {
  const negative = value.startsWith("-");
  const absolute = value.replace("-", "");
  return `${negative ? "−" : "+"} ${formatMoney(absolute)}`;
}

export function TimeBasedProgramCard({ subscription: sub, canMutate, memberActive, destinations, busy,
  onTransfer, onEdit, onOpeningCoverage, onVoidOpening }: CardProps) {
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const allocations = sub.balanceHistory.filter(entry => entry.type === "PAYMENT");
  const canTransfer = canOfferTransfer({ canMutate, memberActive, activeFlag: sub.activeFlag,
    carry: sub.carryBalance, destinationCount: destinations.length });

  return <article className={styles.programCard}>
    <header className={styles.programHead}>
      <div>
        <span className={styles.programKicker}><CalendarDays size={14} aria-hidden="true" /> TIME BASED PROGRAM</span>
        <strong>{sub.event.code} · {sub.event.eventName}</strong>
        <small>{sub.referenceNo || sub.displayName || "Tanpa referensi"}{sub.displayName && sub.referenceNo ? ` · ${sub.displayName}` : ""}</small>
      </div>
      <span className={styles.statusPill} data-status={sub.status}>{sub.status}</span>
    </header>

    {canMutate ? <div className={styles.cardActions}>
      {canTransfer ? <Button size="sm" icon={<ArrowLeftRight size={14} />} disabled={busy} onClick={() => onTransfer(sub)}>Transfer Carry</Button> : null}
      <Button size="sm" variant="ghost" icon={<BookOpenText size={14} />} disabled={busy}
        onClick={() => setLedgerOpen(open => !open)}>{ledgerOpen ? "Hide Ledger" : "View Ledger"}</Button>
      <Button size="sm" variant="ghost" icon={<Pencil size={14} />} disabled={busy} onClick={() => onEdit(sub)}>Edit</Button>
      <Button size="sm" variant="ghost" icon={<CalendarPlus size={14} />} disabled={busy} onClick={() => onOpeningCoverage(sub)}>Opening coverage</Button>
    </div> : null}

    <div className={styles.programBody}>
      <section className={styles.programFacts} aria-label="Informasi program">
        <span className={styles.subsectionTitle}>Informasi program</span>
        <div className={styles.factList}>
          <div><span>Current rule</span><strong>{sub.timeRule ? `${formatMoney(sub.timeRule.unitAmount)} / ${sub.timeRule.durationMonths} bln` : "Tidak ada rule aktif"}</strong></div>
          <div><span>Mulai</span><strong>{sub.startDate ? formatDate(sub.startDate) : "—"}</strong></div>
          <div><span>Berlaku sampai</span><strong>{sub.validUntil ? formatDate(sub.validUntil) : "—"}</strong></div>
        </div>
      </section>

      <section className={styles.financialPanel} aria-label="Ringkasan alokasi">
        <span className={styles.subsectionTitle}>Ringkasan alokasi</span>
        <div className={styles.allocationRows}>
          <div><span>Principal</span><strong className={styles.money}>{formatMoney(sub.principal)}</strong></div>
          <div><span>Consumed</span><strong className={styles.money}>{formatMoney(sub.consumed)}</strong></div>
        </div>
        <div className={styles.carryHighlight}><span aria-hidden="true"><WalletCards size={18} /></span><div><small>Carry tersedia</small><strong className={styles.money}>{formatMoney(sub.carryBalance)}</strong></div></div>
      </section>

      <section className={styles.transferPanel} aria-label="Transfer program">
        <span className={styles.subsectionTitle}>Transfer</span>
        <div className={styles.transferFigures}>
          <div><span className={styles.transferIn} aria-hidden="true"><ArrowDownLeft size={15} /></span><small>Transfer in</small><strong>{formatMoney(sub.transferIn)}</strong></div>
          <div><span className={styles.transferOut} aria-hidden="true"><ArrowUpRight size={15} /></span><small>Transfer out</small><strong>{formatMoney(sub.transferOut)}</strong></div>
        </div>
        <div className={styles.rateNote}><Landmark size={14} aria-hidden="true" /><span>Historical rate follows the ledger below.</span></div>
      </section>

      <section className={`${styles.subsection} ${styles.coveragePanel}`}>
        <div className={styles.coverageHeading}><span className={styles.subsectionTitle}>Coverage timeline</span><span>{sub.coverage.length} record</span></div>
        {sub.coverage.length ? <div className={styles.coverageList}>{sub.coverage.map(coverage => <div key={coverage.coverageId} className={styles.coverageRow}>
          <div>
            <strong>{coverage.source === "OPENING" ? coverageSourceLabel("OPENING")
              : coverage.source === "TRANSFER" ? coverageSourceLabel("TRANSFER")
                : `+${(coverage.grantedUnits ?? 0) * (coverage.durationMonths ?? 0)} bulan`}</strong>
            <span>{formatDate(coverage.coverageFrom)} → {formatDate(coverage.coverageTo)}</span>
            <small>{coverage.amountApplied ? formatMoney(coverage.amountApplied) : "Tanpa transaksi"} · {coverage.status}{coverage.voidReason ? ` · ${coverage.voidReason}` : ""}</small>
          </div>
          {canMutate && coverage.source === "OPENING" && coverage.status === "ACTIVE"
            ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => onVoidOpening(sub, coverage.coverageId)}>Void opening</Button> : null}
        </div>)}</div> : <p className={styles.emptySmall}>Belum ada coverage.</p>}
      </section>

      <section className={`${styles.subsection} ${styles.ratePanel}`}>
        <span className={styles.subsectionTitle}>Applied historical rate</span>
        {allocations.length ? allocations.map(entry => <div key={entry.ledgerId} className={styles.listRow}>
          <div>
            <strong>{entry.unitAmount ? `${formatMoney(entry.unitAmount)} / ${entry.durationMonths ?? 0} bln` : "Snapshot tidak tersedia"}</strong>
            <span>{formatDate(entry.effectiveDate)}{entry.referenceNo ? ` · ${entry.referenceNo}` : ""}</span>
            <small>Applied to {formatMoney(entry.amountDelta.replace("-", ""))} · {entry.status}{entry.voidReason ? ` · ${entry.voidReason}` : ""}</small>
          </div>
        </div>) : <p className={styles.emptySmall}>Belum ada alokasi historis.</p>}
      </section>
    </div>

    {ledgerOpen ? <div className={styles.subsection} aria-label="Balance history">
      <span className={styles.subsectionTitle}>Balance history · Latest 24 entries</span>
      {sub.balanceHistory.length ? sub.balanceHistory.map(entry => {
        const kind = ledgerEntryKind(entry.type);
        return <div key={entry.ledgerId} className={styles.listRow}>
          <div>
            <strong>{ledgerEntryLabel(entry.type)} · <span className={kind === "DEBIT" ? styles.debit : kind === "CREDIT" ? styles.credit : undefined}>{signedMoney(entry.amountDelta)}</span></strong>
            <span>{formatDate(entry.effectiveDate)}{entry.referenceNo ? ` · ${entry.referenceNo}` : ""}</span>
            <small>{entry.status}{entry.voidReason ? ` · ${entry.voidReason}` : ""}</small>
          </div>
        </div>;
      }) : <p className={styles.emptySmall}>Belum ada ledger.</p>}
    </div> : null}
  </article>;
}
