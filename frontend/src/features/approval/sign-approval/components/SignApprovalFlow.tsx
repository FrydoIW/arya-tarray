import { ArrowRight, CheckSquare2, Clock3, UploadCloud, UserRoundCheck } from "lucide-react";
import { Card } from "@/components/ui/Card";
import styles from "../styles/sign-approval.module.css";

export function SignApprovalFlow() {
  return (
    <Card className={styles.flowCard}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>How sign approval works</h2>
          <p>Review the submitted statement and make one final decision as an approver assigned at submission time.</p>
        </div>
      </div>

      <div className={styles.flowSteps}>
        <div className={styles.flowStep}>
          <span className={`${styles.flowIcon} ${styles.blue}`}><UploadCloud size={21} /></span>
          <div><strong>Statement Upload</strong><p>Statement is submitted by the operator.</p></div>
        </div>
        <ArrowRight size={18} className={styles.flowArrow} />
        <div className={styles.flowStep}>
          <span className={`${styles.flowIcon} ${styles.gold}`}><Clock3 size={21} /></span>
          <div><strong>Pending Approval</strong><p>The request waits in your eligible queue.</p></div>
        </div>
        <ArrowRight size={18} className={styles.flowArrow} />
        <div className={styles.flowStep}>
          <span className={`${styles.flowIcon} ${styles.blue}`}><UserRoundCheck size={21} /></span>
          <div><strong>Your Decision</strong><p>Approve or reject after read-only review.</p></div>
        </div>
        <ArrowRight size={18} className={styles.flowArrow} />
        <div className={styles.flowStep}>
          <span className={`${styles.flowIcon} ${styles.green}`}><CheckSquare2 size={21} /></span>
          <div><strong>Complete / Returned</strong><p>Approved is finalized; rejected returns to reconciliation.</p></div>
        </div>
      </div>

    </Card>
  );
}
