import { CheckCircle2, Clock3, FileCheck2, XCircle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { formatDateTime } from "@/lib/format";
import type { ApprovalHistoryItem, SignApprovalDetail } from "../types";
import styles from "../styles/sign-approval.module.css";

function actionMeta(item: ApprovalHistoryItem) {
  if (item.action === "SUBMITTED") {
    return {
      title: `Submitted by ${item.actionBy.fullName}`,
      icon: <FileCheck2 size={15} />,
      tone: styles.historyDefault
    };
  }
  if (item.action === "APPROVED") {
    return {
      title: `Approved by ${item.actionBy.fullName}`,
      icon: <CheckCircle2 size={15} />,
      tone: styles.historyApproved
    };
  }
  if (item.action === "REJECTED") {
    return {
      title: `Rejected by ${item.actionBy.fullName}`,
      icon: <XCircle size={15} />,
      tone: styles.historyRejected
    };
  }
  return {
    title: `${item.action.replaceAll("_", " ")} by ${item.actionBy.fullName}`,
    icon: <FileCheck2 size={15} />,
    tone: styles.historyDefault
  };
}

type ApprovalHistoryTimelineProps = {
  detail: SignApprovalDetail;
};

export function ApprovalHistoryTimeline({ detail }: ApprovalHistoryTimelineProps) {
  const explicitSubmitted = detail.history.some((item) => item.action === "SUBMITTED");

  return (
    <Card className={styles.historyCard}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Approval History</h2>
          <p>Recorded actions are retained as the audit trail for this approval request.</p>
        </div>
      </div>

      <div className={styles.timeline}>
        {!explicitSubmitted ? (
          <div className={styles.timelineItem}>
            <span className={`${styles.historyIcon} ${styles.historyDefault}`}><FileCheck2 size={15} /></span>
            <div>
              <strong>Submitted by {detail.approval.submittedBy.fullName}</strong>
              <p>Statement submitted for approval.</p>
            </div>
            <time>{formatDateTime(detail.approval.submittedAt)}</time>
          </div>
        ) : null}

        {detail.history.map((item) => {
          const meta = actionMeta(item);
          return (
            <div key={item.id} className={styles.timelineItem}>
              <span className={`${styles.historyIcon} ${meta.tone}`}>{meta.icon}</span>
              <div>
                <strong>{meta.title}</strong>
                <p>{item.remark || "Approval action recorded."}</p>
              </div>
              <time>{formatDateTime(item.actionAt)}</time>
            </div>
          );
        })}

        {detail.approval.status === "PENDING" ? (
          <div className={styles.timelineItem}>
            <span className={`${styles.historyIcon} ${styles.historyPending}`}><Clock3 size={15} /></span>
            <div>
              <strong>Awaiting decision</strong>
              <p>Waiting for any one configured eligible approver.</p>
            </div>
            <time>Current</time>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
