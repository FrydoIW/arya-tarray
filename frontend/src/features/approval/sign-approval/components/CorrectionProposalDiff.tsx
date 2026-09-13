import { ArrowRight, Plus, ShieldMinus, Sparkles } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import type { ApprovalCorrectionItem, ApprovalEventCode, SignApprovalDetail } from "../types";
import styles from "../styles/sign-approval.module.css";

function eventLabel(value: ApprovalEventCode | null) {
  return value ? `${value.code} — ${value.eventName}` : "—";
}

function Change({ label, before, after }: { label: string; before: string; after: string }) {
  if (before === after) return null;
  return <div className={styles.diffChange}><span>{label}</span><strong>{before}</strong><ArrowRight size={14} /><strong>{after}</strong></div>;
}

function itemHeading(item: ApprovalCorrectionItem) {
  if (item.action === "ADDED") return item.manualDescription || "Manual Adjustment";
  return item.transaction?.description || item.transaction?.referenceNo || "Bank transaction";
}

export function CorrectionProposalDiff({ proposal }: { proposal: NonNullable<SignApprovalDetail["correctionProposal"]> }) {
  return (
    <section className={styles.correctionDiff}>
      <div className={styles.correctionDiffHeader}><div><h3>Edit Income Correction Proposal</h3><p>Current approved values remain official until approval. Original statement: {formatMoney(proposal.originalStatementAmount)}.</p></div><div className={styles.correctionTotals}><span>Current Official {formatMoney(proposal.currentOfficialAmount)}</span><ArrowRight size={14} /><strong>Proposed {formatMoney(proposal.proposedCorrectedAmount)}</strong></div></div>
      <div className={styles.correctionCounts}><span>{proposal.summary.modifiedTransactions} Modified</span><span>{proposal.summary.addedAdjustments} Added</span><span>{proposal.summary.excludedTransactions} Excluded</span></div>
      <div className={styles.diffList}>{proposal.items.map((item) => (
        <article className={styles.diffItem} key={item.id}>
          <div className={styles.diffItemTitle}><span className={`${styles.diffAction} ${styles[`diff${item.action}`]}`}>{item.action === "MODIFIED" ? <Sparkles size={13} /> : item.action === "ADDED" ? <Plus size={13} /> : <ShieldMinus size={13} />}{item.action}</span><div><strong>{itemHeading(item)}</strong><small>{item.action === "ADDED" ? `${item.manualTransactionDate ? formatDate(item.manualTransactionDate) : "—"} · Source MANUAL` : `${item.transaction?.sourceType === "MANUAL" ? "Source MANUAL" : item.transaction?.referenceNo || "No reference"} · ${item.transaction?.originalAmount ? formatMoney(item.transaction.originalAmount) : "—"}`}</small></div></div>
          {item.action === "MODIFIED" ? <div className={styles.diffChanges}><Change label="Final Event" before={eventLabel(item.beforeEvent)} after={eventLabel(item.proposedEvent)} /><Change label="Campaign" before={item.beforeCampaign?.campaignName ?? "—"} after={item.proposedCampaign?.campaignName ?? "—"} /><Change label="Remark" before={item.beforeRemark || "—"} after={item.proposedRemark || "—"} /></div> : null}
          {item.action === "ADDED" ? <div className={styles.diffFacts}><span>Amount <strong>{item.manualOriginalAmount ? formatMoney(item.manualOriginalAmount) : "—"}</strong></span><span>Final Event <strong>{eventLabel(item.proposedEvent)}</strong></span><span>Campaign <strong>{item.proposedCampaign?.campaignName ?? "—"}</strong></span><span>Remark <strong>{item.proposedRemark || "—"}</strong></span></div> : null}
          {item.correctionReason ? <div className={styles.diffReason}><span>Correction Reason</span><strong>{item.correctionReason}</strong></div> : null}
        </article>
      ))}</div>
    </section>
  );
}
