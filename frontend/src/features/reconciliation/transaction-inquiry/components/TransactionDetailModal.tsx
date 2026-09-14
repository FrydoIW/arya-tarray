"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { TransactionInquiryDetail } from "../types";
import { eventLabel } from "../utils/transaction-inquiry.utils";
import styles from "../styles/transaction-inquiry.module.css";

function DetailItem({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }) {
  return <div className={wide ? styles.detailWide : ""}><span>{label}</span><strong>{value || "-"}</strong></div>;
}

export function TransactionDetailModal({ detail, open, canViewMemberData, onClose }: { detail: TransactionInquiryDetail | null; open: boolean; canViewMemberData: boolean; onClose: () => void }) {
  if (!detail) return null;
  const transaction = detail.transaction;
  const outgoing = transaction.originalAmount.trim().startsWith("-");
  return (
    <Modal open={open} title="Transaction Detail" description="Read-only bank source, reconciliation classification, and audit history." onClose={onClose}>
      <div className={styles.modalBody}>
        <section className={styles.detailSection}>
          <h3>Statement</h3>
          <div className={styles.detailGrid}>
            <DetailItem label="Statement ID" value={detail.statement.id} wide />
            <DetailItem label="Bank Account" value={`${detail.statement.bankAccount.bankCode} - ${detail.statement.bankAccount.accountNo}`} />
            <DetailItem label="Period" value={`${formatDate(detail.statement.periodFrom)} - ${formatDate(detail.statement.periodTo)}`} />
            <DetailItem label="Status" value={detail.statement.displayStatus} />
            <DetailItem label="File Name" value={detail.statement.fileName} />
          </div>
        </section>
        <section className={styles.detailSection}>
          <h3>Member</h3>
          <div className={styles.detailGrid}>
            <DetailItem label="Canonical Member" value={transaction.member ? (
              canViewMemberData
                ? <Link className={styles.memberDetailLink} href={`/member/data/${transaction.member.memberId}`}>{transaction.member.memberCode} - {transaction.member.memberName}</Link>
                : `${transaction.member.memberCode} - ${transaction.member.memberName}`
            ) : "Belum Terhubung"} wide />
            <DetailItem label="Member Status" value={transaction.member ? transaction.member.activeFlag ? "Active" : "Inactive" : "-"} />
            <DetailItem label="Identity Status" value={transaction.memberIdentity?.verificationStatus ?? "-"} />
            <DetailItem label="Identity ID" value={transaction.memberIdentity?.id ?? "-"} />
            <DetailItem label="Account / Sender Evidence" value={transaction.memberIdentity?.accountName ?? transaction.senderName ?? "-"} />
          </div>
        </section>
        <section className={styles.detailSection}>
          <h3>Bank Transaction</h3>
          <div className={styles.detailGrid}>
            <DetailItem label="Date" value={formatDate(transaction.transactionDate)} />
            <DetailItem label="Transaction Type" value={transaction.transactionType} />
            <DetailItem label="Reference No." value={transaction.referenceNo} />
            <DetailItem label="Sender" value={transaction.senderName} />
            <DetailItem label="Original Amount" value={formatMoney(transaction.originalAmount)} />
            <DetailItem label="Suffix" value={transaction.suffixCode} />
            <DetailItem label="Base Amount" value={transaction.baseAmount ? formatMoney(transaction.baseAmount) : "-"} />
            <DetailItem label="Source" value={transaction.sourceType === "MANUAL" ? "Manual Adjustment" : "Bank Statement"} />
            <DetailItem label="Remark" value={transaction.remark} />
            {transaction.sourceType === "MANUAL" ? <DetailItem label="Correction Reason" value={transaction.correctionReason} /> : null}
            {transaction.sourceType === "MANUAL" ? <DetailItem label="Added By / At" value={`${transaction.manualAddedBy?.fullName ?? "-"} · ${transaction.manualAddedAt ? formatDateTime(transaction.manualAddedAt) : "-"}`} /> : null}
            {transaction.reconciliationExcludedAt ? <DetailItem label="Reconciliation State" value="Excluded" /> : null}
            {transaction.reconciliationExcludedAt ? <DetailItem label="Excluded By / At" value={`${transaction.reconciliationExcludedBy?.fullName ?? "-"} · ${formatDateTime(transaction.reconciliationExcludedAt)}`} /> : null}
            {transaction.reconciliationExcludedAt ? <DetailItem label="Exclusion Reason" value={transaction.reconciliationExclusionReason} wide /> : null}
            <DetailItem label="Description" value={transaction.description} wide />
          </div>
        </section>
        <section className={styles.detailSection}>
          <h3>Classification</h3>
          <div className={styles.classificationGrid}>
            <div><span>Suggested Event</span><strong>{outgoing ? "Outgoing" : eventLabel(transaction.suggestedEvent)}</strong><small>{outgoing ? "Event Code is not required for debit transactions" : "Machine suggestion at upload"}</small></div>
            <div><span>Final Event</span><strong>{outgoing ? "Outgoing" : eventLabel(transaction.finalEvent)}</strong><small>{outgoing ? "Direction provides the business meaning" : "Current operator-approved classification"}</small></div>
            <div><span>Campaign</span><strong>{transaction.eventCampaign?.campaignName ?? "—"}</strong><small>Official Campaign assignment</small></div>
          </div>
        </section>
        {transaction.sponsorship ? <section className={styles.detailSection}><h3>Rupang sponsorship</h3><div className={styles.detailGrid}>
          <DetailItem label="Rule snapshot / rate" value={`${formatMoney(transaction.sponsorship.unitAmount)} = ${transaction.sponsorship.durationMonths} month`} />
          <DetailItem label="Principal (base amount)" value={formatMoney(transaction.sponsorship.principalAmount)} />
          <DetailItem label="Payment credited to subscription" value={transaction.sponsorship.paymentCredited ? formatMoney(transaction.sponsorship.paymentCredited) : "Pending allocation"} />
          <DetailItem label="Allocation" value={transaction.sponsorship.allocation ? transaction.sponsorship.allocation.referenceNo || transaction.sponsorship.allocation.displayName || "Allocated" : "Pending allocation"} />
          <DetailItem label={transaction.sponsorship.allocation ? "Coverage generated after this payment" : "Months from payment alone"} value={`${transaction.sponsorship.grantedMonths} months`} />
          <DetailItem label="Coverage period" value={transaction.sponsorship.allocation?.coverageFrom && transaction.sponsorship.allocation.coverageTo ? `${formatDate(transaction.sponsorship.allocation.coverageFrom)} – ${formatDate(transaction.sponsorship.allocation.coverageTo)}` : "No coverage generated"} />
          <DetailItem label="Subscription carry balance after processing" value={transaction.sponsorship.carryBalanceAfterPayment !== null ? formatMoney(transaction.sponsorship.carryBalanceAfterPayment) : "—"} />
        </div></section> : null}
        <section className={styles.detailSection}>
          <h3>Transaction History</h3>
          {detail.history.length === 0 ? <div className={styles.emptyHistory}>No manual changes have been recorded for this transaction.</div> : (
            <div className={styles.historyList}>
              {detail.history.map((item) => (
                <article key={item.id}>
                  <div><strong>{item.fieldName === "event_code_id" ? "Final Event" : item.fieldName === "event_campaign_id" ? "Campaign" : item.fieldName === "remark" ? "Remark" : item.fieldName || "Change"}</strong><span>{formatDateTime(item.changedAt)}</span></div>
                  <p><b>{item.oldValueLabel || "-"}</b><i>→</i><b>{item.newValueLabel || "-"}</b></p>
                  <small>{item.changedBy.fullName}{item.remark ? ` · ${item.remark}` : ""}</small>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
