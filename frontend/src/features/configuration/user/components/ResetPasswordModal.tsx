"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { UserItem } from "../types";
import styles from "../styles/user.module.css";

type ResetPasswordModalProps = {
  user: UserItem | null;
  disabled?: boolean;
  onClose: () => void;
  onStage: (userId: string, password: string) => void;
};

export function ResetPasswordModal({ user, disabled = false, onClose, onStage }: ResetPasswordModalProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    setPassword("");
    setConfirmPassword("");
    setError("");
  }, [user]);

  function submit() {
    if (!user) return;
    if (password.length < 8) return setError("Password minimal 8 karakter.");
    if (password !== confirmPassword) return setError("Password confirmation tidak sama.");
    onStage(user.id, password);
    onClose();
  }

  return (
    <Modal
      open={Boolean(user)}
      title="Reset Password"
      description={user ? `Stage a new password for ${user.fullName}. It will only be saved after Execute.` : undefined}
      onClose={onClose}
    >
      <div className={styles.modalBody}>
        {error ? <div className="ui-alert ui-alert-error">{error}</div> : null}
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>New Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Minimum 8 characters" autoComplete="new-password" autoFocus />
          </label>
          <label className={styles.field}>
            <span>Confirm Password</span>
            <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat new password" autoComplete="new-password" />
          </label>
        </div>
      </div>

      <div className={styles.modalFooter}>
        <Button type="button" variant="secondary" onClick={onClose} disabled={disabled}>Cancel</Button>
        <Button type="button" icon={<KeyRound size={16} />} onClick={submit} disabled={disabled}>Stage Password</Button>
      </div>
    </Modal>
  );
}
