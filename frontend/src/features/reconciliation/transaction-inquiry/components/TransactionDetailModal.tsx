"use client";

import type { ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { TransactionInquiryDetail } from "../types";
import { eventLabel } from "../utils/transaction-inquiry.utils";
import styles from "../styles/transaction-inquiry.module.css";

function DetailItem({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }) {
  return <div className={wide ? styles.detailWide : ""}><span>{label}</span><strong>{value || "-"}</strong></div>;
}

export function TransactionDetailModal({ detail, open, onClose }: { detail: TransactionInquiryDetail | null; open: boolean; onClose: () => void }) {
  if (!detail) return null;
  const transaction = detail.transaction;
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
          <h3>Bank Transaction</h3>
          <div className={styles.detailGrid}>
            <DetailItem label="Date" value={formatDate(transaction.transactionDate)} />
            <DetailItem label="Transaction Type" value={transaction.transactionType} />
            <DetailItem label="Reference No." value={transaction.referenceNo} />
            <DetailItem label="Sender" value={transaction.senderName} />
            <DetailItem label="Original Amount" value={formatMoney(transaction.originalAmount)} />
            <DetailItem label="Suffix" value={transaction.suffixCode} />
            <DetailItem label="Base Amount" value={transaction.baseAmount ? formatMoney(transaction.baseAmount) : "-"} />
            <DetailItem label="Remark" value={transaction.remark} />
            <DetailItem label="Description" value={transaction.description} wide />
          </div>
        </section>
        <section className={styles.detailSection}>
          <h3>Classification</h3>
          <div className={styles.classificationGrid}>
            <div><span>Suggested Event</span><strong>{eventLabel(transaction.suggestedEvent)}</strong><small>Machine suggestion at upload</small></div>
            <div><span>Final Event</span><strong>{eventLabel(transaction.finalEvent)}</strong><small>Current operator-approved classification</small></div>
          </div>
        </section>
        <section className={styles.detailSection}>
          <h3>Transaction History</h3>
          {detail.history.length === 0 ? <div className={styles.emptyHistory}>No manual changes have been recorded for this transaction.</div> : (
            <div className={styles.historyList}>
              {detail.history.map((item) => (
                <article key={item.id}>
                  <div><strong>{item.fieldName === "event_code_id" ? "Final Event" : item.fieldName === "remark" ? "Remark" : item.fieldName || "Change"}</strong><span>{formatDateTime(item.changedAt)}</span></div>
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
