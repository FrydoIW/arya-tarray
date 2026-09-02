import { ArrowRight, UsersRound } from "lucide-react";
import { Card } from "@/components/ui/Card";
import styles from "../styles/role.module.css";

export function RoleUsageRule() {
  return (
    <Card className={styles.exampleCard}>
      <div className={styles.exampleHead}>
        <span className={styles.exampleIcon}><UsersRound size={19} /></span>
        <div>
          <h2>How roles are used</h2>
          <p>Roles determine what users can access and what actions they can perform in the system.</p>
        </div>
      </div>

      <div className={styles.flow}>
        <div><small>User</small><strong>Arya Tarray Admin</strong></div>
        <ArrowRight size={18} />
        <div><small>Assigned Role</small><strong className={styles.primaryValue}>ADMIN</strong></div>
        <ArrowRight size={18} />
        <div><small>System Access</small><strong>Full access</strong></div>
        <ArrowRight size={18} />
        <div><small>Feature Scope</small><strong>All configuration and operations</strong></div>
      </div>
    </Card>
  );
}
