import { UserRound } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { formatDateTime } from "@/lib/format";
import type { SignApprovalDetail } from "../types";
import {
  approvalStatusLabel,
  approvalStatusTone,
  formatStatementPeriod
} from "../utils/sign-approval.utils";
import styles from "../styles/sign-approval.module.css";

type StatementDetailCardProps = {
  detail: SignApprovalDetail;
};

export function StatementDetailCard({ detail }: StatementDetailCardProps) {
  const { approval, statement, configuredApprovers } = detail;

  return (
    <Card className={styles.statementCard}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Statement Detail</h2>
          <p>Read-only approval context for the selected statement.</p>
        </div>
      </div>

      <div className={styles.statementGrid}>
        <dl className={styles.detailList}>
          <div><dt>Statement ID</dt><dd className={styles.detailId}>{statement.id}</dd></div>
          <div><dt>Bank Account</dt><dd>{statement.bankAccount.bankName} · {statement.bankAccount.accountNo}</dd></div>
          <div><dt>Period</dt><dd>{formatStatementPeriod(statement.periodFrom, statement.periodTo)}</dd></div>
        </dl>

        <dl className={styles.detailList}>
          <div><dt>Uploaded By</dt><dd>{statement.uploadedBy.fullName}</dd></div>
          <div><dt>Submitted At</dt><dd>{formatDateTime(approval.submittedAt)}</dd></div>
          <div>
            <dt>Status</dt>
            <dd>
              <span className={`${styles.statusBadge} ${styles[approvalStatusTone(approval.status)]}`}>
                <i aria-hidden="true" />
                {approvalStatusLabel(approval.status)}
              </span>
            </dd>
          </div>
        </dl>

        <div className={styles.approverBlock}>
          <span>Approval Approvers (at submission)</span>
          <div className={styles.approverList}>
            {configuredApprovers.map((approver) => (
              <div key={approver.id} className={styles.approverChip}>
                <span><UserRound size={14} /></span>
                <div>
                  <strong>{approver.fullName}</strong>
                  <small>{approver.email}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
