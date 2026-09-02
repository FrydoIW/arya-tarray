"use client";

import { useState, type ChangeEvent } from "react";
import { ArrowLeft, Check, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { SignApprovalDetail } from "../types";
import { approvalStatusLabel } from "../utils/sign-approval.utils";
import styles from "../styles/sign-approval.module.css";

type ApprovalDecisionPanelProps = {
  detail: SignApprovalDetail;
  deciding: boolean;
  onBack: () => void;
  onApprove: (remark?: string) => Promise<boolean>;
  onReject: (remark: string) => Promise<boolean>;
  onDecided: () => void | Promise<void>;
};

export function ApprovalDecisionPanel({
  detail,
  deciding,
  onBack,
  onApprove,
  onReject,
  onDecided
}: ApprovalDecisionPanelProps) {
  const [remark, setRemark] = useState("");
  const [validationError, setValidationError] = useState("");

  const canDecide = detail.approval.canDecide;

  async function approve() {
    setValidationError("");
    const ok = await onApprove(remark.trim() || undefined);
    if (ok) await onDecided();
  }

  async function reject() {
    const value = remark.trim();
    if (!value) {
      setValidationError("Remark wajib diisi untuk reject.");
      return;
    }
    setValidationError("");
    const ok = await onReject(value);
    if (ok) await onDecided();
  }

  return (
    <Card className={styles.decisionCard}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Approval Decision</h2>
          <p>
            {canDecide
              ? "Approve immediately or reject with a required remark. The first valid decision is final for this request."
              : `This request is already ${approvalStatusLabel(detail.approval.status).toLowerCase()} and is now read-only.`}
          </p>
        </div>
      </div>

      <label className={styles.remarkField}>
        <span>Remark {canDecide ? <small>Optional for Approve · Required for Reject</small> : null}</span>
        <textarea
          value={remark}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            setRemark(event.target.value);
            if (validationError) setValidationError("");
          }}
          placeholder="Add approval or rejection note..."
          maxLength={1000}
          disabled={!canDecide || deciding}
        />
      </label>
      {validationError ? <div className={styles.inlineError}>{validationError}</div> : null}

      <div className={styles.decisionActions}>
        <Button type="button" variant="secondary" icon={<ArrowLeft size={15} />} onClick={onBack} disabled={deciding}>
          Back to Queue
        </Button>
        <div>
          <Button
            type="button"
            variant="danger"
            icon={<X size={15} />}
            onClick={() => void reject()}
            disabled={!canDecide || deciding}
          >
            Reject
          </Button>
          <Button
            type="button"
            icon={<Check size={15} />}
            onClick={() => void approve()}
            disabled={!canDecide || deciding}
          >
            {deciding ? "Processing..." : "Approve"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
