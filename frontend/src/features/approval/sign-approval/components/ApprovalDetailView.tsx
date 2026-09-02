"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useSignApprovalDetail } from "../hooks/useSignApprovalDetail";
import { ApprovalDecisionPanel } from "./ApprovalDecisionPanel";
import { ApprovalDetailSummary } from "./ApprovalDetailSummary";
import { ApprovalHistoryTimeline } from "./ApprovalHistoryTimeline";
import { StatementDetailCard } from "./StatementDetailCard";
import { TransactionPreview } from "./TransactionPreview";
import styles from "../styles/sign-approval.module.css";

type ApprovalDetailViewProps = {
  approvalId: string | null;
  onBack: () => void;
  onDecided: () => void | Promise<void>;
};

export function ApprovalDetailView({ approvalId, onBack, onDecided }: ApprovalDetailViewProps) {
  const state = useSignApprovalDetail(approvalId);

  if (!approvalId) {
    return (
      <section className={styles.emptyDetail}>
        <EmptyState
          title="Select an approval request"
          description="Open Approval Queue and choose Review before viewing Approval Detail."
        />
      </section>
    );
  }

  if (state.loading && !state.detail) {
    return <div className={styles.detailLoading}>Loading approval detail…</div>;
  }

  if (!state.detail) {
    return (
      <section className={styles.emptyDetail}>
        {state.error ? <div className="ui-alert ui-alert-error">{state.error}</div> : null}
        <EmptyState
          title="Approval detail unavailable"
          description="The request may no longer be available to your current approver access."
        />
        <div className={styles.centerActions}>
          <Button type="button" variant="secondary" onClick={onBack}>Back to Queue</Button>
          <Button type="button" variant="outline" icon={<RefreshCw size={14} />} onClick={() => void state.refresh()}>
            Reload
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className={styles.detailStack}>
      {state.error ? <div className="ui-alert ui-alert-error">{state.error}</div> : null}


      <StatementDetailCard detail={state.detail} />
      <ApprovalDetailSummary summary={state.detail.summary} />
      <TransactionPreview
        items={state.detail.transactionPreview}
        totalTransactions={state.detail.summary.totalTransactions}
      />
      <ApprovalHistoryTimeline detail={state.detail} />
      <ApprovalDecisionPanel
        detail={state.detail}
        deciding={state.deciding}
        onBack={onBack}
        onApprove={state.approve}
        onReject={state.reject}
        onDecided={onDecided}
      />
    </div>
  );
}
