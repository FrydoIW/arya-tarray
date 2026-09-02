import { CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import styles from "../styles/statement-upload.module.css";

type Props = {
  resolved: number;
  needsReview: number;
  relevantIncoming: number;
  canExecute: boolean;
  lifecycleEditable: boolean;
};

export function DraftReviewSummary({ resolved, needsReview, relevantIncoming, canExecute, lifecycleEditable }: Props) {
  const message = !lifecycleEditable
    ? "This statement is no longer a Draft. Classification is read-only while it is pending approval or complete."
    : canExecute
      ? "All required incoming transactions are resolved. Execute is available."
      : "Execute is only available after all required incoming transactions are resolved.";

  return (
    <div className={styles.bottomSummary}>
      <Card className={styles.compactMetric}>
        <span className={`${styles.compactIcon} ${styles.green}`}><CheckCircle2 size={18} /></span>
        <div><small>Resolved Transactions</small><strong>{resolved.toLocaleString("en-US")}</strong></div>
      </Card>
      <Card className={styles.compactMetric}>
        <span className={`${styles.compactIcon} ${styles.gold}`}><TriangleAlert size={18} /></span>
        <div><small>Needs Review</small><strong>{needsReview.toLocaleString("en-US")}</strong></div>
      </Card>
      <Card className={styles.executeNotice}>
        <span className={styles.noticeIcon}><Info size={17} /></span>
        <div>
          <strong>{message}</strong>
          <small>{relevantIncoming.toLocaleString("en-US")} incoming transactions require Event Code classification; debit/outgoing rows do not.</small>
        </div>
      </Card>
    </div>
  );
}
