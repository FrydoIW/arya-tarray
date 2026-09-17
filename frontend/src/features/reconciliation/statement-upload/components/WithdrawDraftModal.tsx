"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import styles from "../styles/statement-upload.module.css";

type WithdrawDraftModalProps = {
  open: boolean;
  fileName: string | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
};

export function WithdrawDraftModal({ open, fileName, loading, onCancel, onConfirm }: WithdrawDraftModalProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason("");
    setError("");
  }, [open]);

  function submit() {
    const value = reason.trim();
    if (!value) {
      setError("Withdrawal reason is required.");
      return;
    }
    setError("");
    void onConfirm(value);
  }

  return (
    <Modal
      open={open}
      title="Withdraw Draft"
      description="This draft will be removed from active reconciliation. The upload audit record will be preserved."
      onClose={onCancel}
    >
      <div className={styles.withdrawBody}>
        {fileName ? <p className={styles.withdrawFile}>{fileName}</p> : null}
        {error ? <div className="ui-alert ui-alert-error">{error}</div> : null}
        <label className={styles.withdrawField}>
          <span>Reason *</span>
          <textarea
            value={reason}
            maxLength={1000}
            disabled={loading}
            placeholder="Required audit reason"
            onChange={(event) => {
              setReason(event.target.value);
              if (error) setError("");
            }}
          />
        </label>
      </div>
      <div className={styles.withdrawActions}>
        <Button type="button" variant="secondary" disabled={loading} onClick={onCancel}>Cancel</Button>
        <Button type="button" variant="danger" disabled={loading} onClick={submit}>
          {loading ? "Withdrawing..." : "Withdraw Draft"}
        </Button>
      </div>
    </Modal>
  );
}
