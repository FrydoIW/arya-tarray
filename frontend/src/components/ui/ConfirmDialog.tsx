"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";
import styles from "./ConfirmDialog.module.css";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loadingLabel?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  loadingLabel = "Executing…",
  loading = false,
  onCancel,
  onConfirm
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const submitLockedRef = useRef(false);
  const busy = loading || pending;

  useEffect(() => {
    if (open) return;
    submitLockedRef.current = false;
    setPending(false);
  }, [open]);

  function cancel() {
    if (!busy) onCancel();
  }

  async function confirm() {
    if (busy || submitLockedRef.current) return;
    submitLockedRef.current = true;
    setPending(true);
    try {
      await onConfirm();
    } finally {
      submitLockedRef.current = false;
      setPending(false);
    }
  }

  return (
    <Modal open={open} title={title} description={message} onClose={cancel}>
      <div className={styles.actions}>
        <Button type="button" variant="secondary" onClick={cancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button type="button" onClick={() => void confirm()} disabled={busy}>
          {busy ? loadingLabel : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
