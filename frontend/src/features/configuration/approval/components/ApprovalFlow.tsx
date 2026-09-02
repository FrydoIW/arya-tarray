import { ArrowRight, CheckCircle2, Clock3, Info, UploadCloud, UsersRound } from "lucide-react";
import { Card } from "@/components/ui/Card";
import styles from "../styles/approval.module.css";

export function ApprovalFlow() {
  return (
    <Card className={styles.flowCard}>
      <div className={styles.flowIntro}>
        <span className={styles.infoIcon}><Info size={20} /></span>
        <div>
          <h2>How approval works</h2>
          <p>Uploaded statements are completed only after one configured approver makes the approval decision.</p>
        </div>
      </div>

      <div className={styles.flowSteps}>
        <div className={styles.flowStep}>
          <span className={`${styles.flowIcon} ${styles.blue}`}><UploadCloud size={22} /></span>
          <div><strong>Statement Upload</strong><p>Statement is uploaded</p></div>
        </div>
        <ArrowRight size={19} className={styles.flowArrow} />
        <div className={styles.flowStep}>
          <span className={`${styles.flowIcon} ${styles.gold}`}><Clock3 size={22} /></span>
          <div><strong>Pending Approval</strong><p>Awaiting approver action</p></div>
        </div>
        <ArrowRight size={19} className={styles.flowArrow} />
        <div className={styles.flowStep}>
          <span className={`${styles.flowIcon} ${styles.violet}`}><UsersRound size={22} /></span>
          <div><strong>Configured Approvers</strong><p>Any one approver may approve</p></div>
        </div>
        <ArrowRight size={19} className={styles.flowArrow} />
        <div className={styles.flowStep}>
          <span className={`${styles.flowIcon} ${styles.green}`}><CheckCircle2 size={22} /></span>
          <div><strong>Complete</strong><p>Statement is marked complete</p></div>
        </div>
      </div>
    </Card>
  );
}
