"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { formatMoney } from "@/lib/format";
import type { StatementDuplicate } from "../types";
import styles from "../styles/statement-upload.module.css";

function dateLabel(value: string | null) {
  return value ? value.slice(0, 10) : "—";
}

export function DuplicateReviewPanel({ duplicates, canResolve, busy, resolvingId, onResolve }: {
  duplicates: StatementDuplicate[];
  canResolve: boolean;
  busy: boolean;
  resolvingId: string | null;
  onResolve: (duplicateId: string, decision: "DISTINCT" | "DUPLICATE", reason: string) => Promise<void> | void;
}) {
  const [decision, setDecision] = useState<{ duplicate: StatementDuplicate; decision: "DISTINCT" | "DUPLICATE"; reason: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const pending = duplicates.filter(row => row.matchType === "POSSIBLE" && row.resolutionStatus === "PENDING_REVIEW");
  const history = duplicates.filter(row => !(row.matchType === "POSSIBLE" && row.resolutionStatus === "PENDING_REVIEW"));
  const compact = pending.length === 0;

  return <section className={`${styles.resultPanel} ${compact ? styles.resultPanelCompact : ""}`}>
    <div className={`${styles.resultHead} ${compact ? styles.resultHeadCompact : ""}`}>
      <div className={styles.resultTitle}>
        <h2>Duplicate review</h2>
        {compact
          ? <span className={styles.resultInfo} title="Reference numbers are not unique bank IDs. Compare sender, description, source row, and amount before deciding." aria-label="Duplicate review information"><Info size={14} /></span>
          : <p>Reference numbers are not treated as unique bank IDs. Compare sender, description, source row, and amount before deciding.</p>}
      </div>
      <span className={styles.resultBadge}>{pending.length} pending</span>
    </div>
    {!compact ? <div className="ui-table-wrap"><table className="ui-table">
      <thead><tr><th>Incoming source</th><th>Existing / matched transaction</th><th>Amount</th><th>Location</th><th>Action</th></tr></thead>
      <tbody>{pending.map(row => <tr key={row.id}>
        <td>
          <strong>{row.source.referenceNo ?? "(no reference)"}</strong>
          <small>{dateLabel(row.source.transactionDate)} · {row.source.senderName ?? "—"}</small>
          <small>{row.source.description ?? "—"}</small>
        </td>
        <td>
          <strong>{row.matchedTransaction.referenceNo ?? "(no reference)"}</strong>
          <small>{dateLabel(row.matchedTransaction.transactionDate)} · {row.matchedTransaction.senderName ?? "—"}</small>
          <small>{row.matchedTransaction.description ?? "—"}</small>
          <small>{row.matchedTransaction.fileName}</small>
        </td>
        <td>{formatMoney(row.source.originalAmount)}<small>matched {formatMoney(row.matchedTransaction.originalAmount)}</small></td>
        <td>{row.source.sheetName ?? "—"} row {row.source.worksheetRow ?? row.source.transactionNo}</td>
        <td><div className={styles.duplicateActions}>
          <Button type="button" size="sm" disabled={!canResolve || busy || resolvingId === row.id} onClick={() => setDecision({ duplicate: row, decision: "DISTINCT", reason: "" })}>Keep distinct</Button>
          <Button type="button" size="sm" variant="danger" disabled={!canResolve || busy || resolvingId === row.id} onClick={() => setDecision({ duplicate: row, decision: "DUPLICATE", reason: "" })}>Confirm duplicate</Button>
        </div></td>
      </tr>)}</tbody>
    </table></div> : null}
    {history.length > 0 && !compact ? <div className="ui-table-wrap"><table className="ui-table">
      <thead><tr><th>Result</th><th>Source</th><th>Matched</th><th>Amount</th><th>Reason / actor</th></tr></thead>
      <tbody>{history.map(row => <tr key={row.id}>
        <td>{row.matchType === "EXACT" ? "EXACT skipped" : row.resolutionStatus}</td>
        <td>{row.source.referenceNo ?? "—"}<small>row {row.source.worksheetRow ?? row.source.transactionNo}</small></td>
        <td>{row.matchedTransaction.referenceNo ?? "—"}<small>{row.matchedTransaction.fileName}</small></td>
        <td>{formatMoney(row.source.originalAmount)}</td>
        <td>{row.resolutionReason ?? "—"}{row.resolvedBy ? <small>{row.resolvedBy.fullName} · {row.resolvedAt ? new Date(row.resolvedAt).toLocaleString("en-GB") : "—"}</small> : null}</td>
      </tr>)}</tbody>
    </table></div> : null}
    {history.length > 0 && compact ? <>
      <button type="button" className={styles.resultHistoryToggle} onClick={() => setShowHistory(value => !value)}>
        {showHistory ? "Hide resolved history" : `View resolved history (${history.length})`}
      </button>
      {showHistory ? <div className="ui-table-wrap"><table className="ui-table">
        <thead><tr><th>Result</th><th>Source</th><th>Matched</th><th>Amount</th><th>Reason / actor</th></tr></thead>
        <tbody>{history.map(row => <tr key={row.id}>
          <td>{row.matchType === "EXACT" ? "EXACT skipped" : row.resolutionStatus}</td>
          <td>{row.source.referenceNo ?? "—"}<small>row {row.source.worksheetRow ?? row.source.transactionNo}</small></td>
          <td>{row.matchedTransaction.referenceNo ?? "—"}<small>{row.matchedTransaction.fileName}</small></td>
          <td>{formatMoney(row.source.originalAmount)}</td>
          <td>{row.resolutionReason ?? "—"}{row.resolvedBy ? <small>{row.resolvedBy.fullName} · {row.resolvedAt ? new Date(row.resolvedAt).toLocaleString("en-GB") : "—"}</small> : null}</td>
        </tr>)}</tbody>
      </table></div> : null}
    </> : null}

    <Modal open={decision !== null} title={decision?.decision === "DUPLICATE" ? "Confirm duplicate" : "Keep as distinct transaction"}
      description={decision?.decision === "DUPLICATE"
        ? "The incoming transaction will be excluded from the draft, its item-sale staging will be voided, and statement totals will be reduced. The historical bank row remains preserved."
        : "The incoming transaction remains in the draft as a separate legitimate transaction."}
      onClose={() => !busy && setDecision(null)}>
      {decision ? <div className={styles.modalBody}>
        <div className={styles.duplicateCompare}>
          <div><span>Incoming</span><strong>{decision.duplicate.source.referenceNo ?? "(no reference)"}</strong><small>{dateLabel(decision.duplicate.source.transactionDate)} · {formatMoney(decision.duplicate.source.originalAmount)} · {decision.duplicate.source.senderName ?? "—"}</small></div>
          <div><span>Matched</span><strong>{decision.duplicate.matchedTransaction.referenceNo ?? "(no reference)"}</strong><small>{dateLabel(decision.duplicate.matchedTransaction.transactionDate)} · {formatMoney(decision.duplicate.matchedTransaction.originalAmount)} · {decision.duplicate.matchedTransaction.senderName ?? "—"}</small></div>
        </div>
        <label className={styles.field}>Decision reason<textarea required rows={3} maxLength={1000} value={decision.reason} disabled={busy} onChange={event => setDecision({ ...decision, reason: event.target.value })} /></label>
        <div className={styles.modalFooter}>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setDecision(null)}>Cancel</Button>
          <Button type="button" variant={decision.decision === "DUPLICATE" ? "danger" : "primary"} disabled={busy || decision.reason.trim().length < 3}
            onClick={async () => { await onResolve(decision.duplicate.id, decision.decision, decision.reason.trim()); setDecision(null); }}>
            {busy ? "Menyimpan…" : decision.decision === "DUPLICATE" ? "Confirm duplicate" : "Keep distinct"}
          </Button>
        </div>
      </div> : null}
    </Modal>
  </section>;
}
