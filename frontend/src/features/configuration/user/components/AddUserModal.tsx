"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { AddUserDraftInput, UserRoleOption, UserStatus } from "../types";
import styles from "../styles/user.module.css";

type AddUserModalProps = {
  open: boolean;
  roles: UserRoleOption[];
  disabled?: boolean;
  onClose: () => void;
  onAdd: (input: AddUserDraftInput) => void;
};

export function AddUserModal({ open, roles, disabled = false, onClose, onAdd }: AddUserModalProps) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState("");
  const [status, setStatus] = useState<UserStatus>("ACTIVE");
  const [error, setError] = useState("");
  const activeRoles = useMemo(() => roles.filter((role) => role.activeFlag), [roles]);

  useEffect(() => {
    if (!open) return;
    setFullName("");
    setEmail("");
    setPassword("");
    setRoleId(activeRoles[0]?.id ?? "");
    setStatus("ACTIVE");
    setError("");
  }, [open, activeRoles]);

  function submit() {
    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName) return setError("Full Name wajib diisi.");
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) return setError("Format Email tidak valid.");
    if (password.length < 8) return setError("Password minimal 8 karakter.");
    if (!roleId) return setError("Role wajib dipilih.");

    onAdd({
      fullName: cleanName,
      email: cleanEmail,
      password,
      roleId,
      status
    });
    onClose();
  }

  return (
    <Modal
      open={open}
      title="Add User"
      description="Create a local draft first. The account is written to the database only after Execute."
      onClose={onClose}
    >
      <div className={styles.modalBody}>
        {error ? <div className="ui-alert ui-alert-error">{error}</div> : null}

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Full Name</span>
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="e.g. Reconciliation Operator" autoFocus />
          </label>

          <label className={styles.field}>
            <span>Email</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value.replace(/\s/g, ""))} placeholder="operator@aryatarray.local" />
          </label>

          <label className={styles.field}>
            <span>Initial Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Minimum 8 characters" autoComplete="new-password" />
          </label>

          <label className={styles.field}>
            <span>Role</span>
            <select value={roleId} onChange={(event) => setRoleId(event.target.value)}>
              <option value="">Select role</option>
              {activeRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.roleCode} — {role.roleName}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as UserStatus)}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        </div>
      </div>

      <div className={styles.modalFooter}>
        <Button type="button" variant="secondary" onClick={onClose} disabled={disabled}>Cancel</Button>
        <Button type="button" icon={<Plus size={16} />} onClick={submit} disabled={disabled}>Add Draft</Button>
      </div>
    </Modal>
  );
}
