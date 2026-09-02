import { ArrowRight, Grid3X3, ShieldCheck, UserRound } from "lucide-react";
import { Card } from "@/components/ui/Card";
import styles from "../styles/user.module.css";

export function UserAccessFlow() {
  return (
    <Card className={styles.accessFlowCard}>
      <div className={styles.accessFlowIntro}>
        <h2>User Access Flow</h2>
        <p>User access is determined through assigned roles and the Role Access Matrix.</p>
      </div>

      <div className={styles.accessFlowSteps}>
        <div className={styles.accessStep}>
          <span className={`${styles.accessIcon} ${styles.blue}`}><UserRound size={23} /></span>
          <div>
            <small>1</small>
            <strong>User</strong>
            <p>Create the account and assign one system role.</p>
          </div>
        </div>
        <ArrowRight size={19} className={styles.flowArrow} />
        <div className={styles.accessStep}>
          <span className={`${styles.accessIcon} ${styles.green}`}><ShieldCheck size={23} /></span>
          <div>
            <small>2</small>
            <strong>Role</strong>
            <p>The assigned role defines the user's access level.</p>
          </div>
        </div>
        <ArrowRight size={19} className={styles.flowArrow} />
        <div className={styles.accessStep}>
          <span className={`${styles.accessIcon} ${styles.violet}`}><Grid3X3 size={23} /></span>
          <div>
            <small>3</small>
            <strong>Menu Access Matrix</strong>
            <p>Role permissions determine accessible sidebar pages.</p>
          </div>
        </div>
      </div>
    </Card>
  );
}
