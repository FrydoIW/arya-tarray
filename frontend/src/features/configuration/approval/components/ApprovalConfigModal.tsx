"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type {
  ApprovalApproverUser,
  ApprovalAssignedApprover,
  ApprovalConfiguration,
  ApprovalMenuOption
} from "../types";
import { resolveApprovers } from "../utils/approval-workspace.utils";
import { ApproverSelector } from "./ApproverSelector";
import styles from "../styles/approval.module.css";

type ModalSubmit = {
  menuId?: string;
  approverUserIds: string[];
  activeFlag: boolean;
};

type ApprovalConfigModalProps = {
  open: boolean;
  mode: "ADD" | "EDIT";
  configuration?: ApprovalConfiguration | null;
  menuOptions: ApprovalMenuOption[];
  approverUsers: ApprovalApproverUser[];
  disabled?: boolean;
  onClose: () => void;
  onSubmit: (value: ModalSubmit) => void;
};

export function ApprovalConfigModal({
  open,
  mode,
  configuration,
  menuOptions,
  approverUsers,
  disabled = false,
  onClose,
  onSubmit
}: ApprovalConfigModalProps) {
  const [menuId, setMenuId] = useState("");
  const [approverUserIds, setApproverUserIds] = useState<string[]>([]);
  const [activeFlag, setActiveFlag] = useState(true);
  const [localError, setLocalError] = useState("");
  const processEditable = mode === "ADD" || Boolean(configuration?.isDraft);

  useEffect(() => {
    if (!open) return;
    setMenuId(configuration?.menu.id ?? menuOptions[0]?.id ?? "");
    setApproverUserIds(configuration?.approvers.map((item) => item.id) ?? []);
    setActiveFlag(configuration?.activeFlag ?? true);
    setLocalError("");
  }, [configuration, menuOptions, open]);

  const selectedApprovers = useMemo<ApprovalAssignedApprover[]>(() => (
    resolveApprovers(approverUserIds, approverUsers, configuration?.approvers ?? [])
  ), [approverUserIds, approverUsers, configuration?.approvers]);

  function submit() {
    if (processEditable && !menuId) {
      setLocalError("Process/Menu wajib dipilih.");
      return;
    }
    if (approverUserIds.length === 0) {
      setLocalError("Minimal satu approver wajib dipilih.");
      return;
    }

    const eligibleIds = new Set(approverUsers.map((item) => item.id));
    if (activeFlag && !approverUserIds.some((id) => eligibleIds.has(id))) {
      setLocalError("Configuration Active membutuhkan minimal satu approver yang masih eligible.");
      return;
    }

    setLocalError("");
    onSubmit({
      menuId: processEditable ? menuId : undefined,
      approverUserIds,
      activeFlag
    });
  }

  return (
    <Modal
      open={open}
      title={mode === "ADD" ? "Add Approval Configuration" : "Edit Approval Configuration"}
      description={mode === "ADD"
        ? "Create a local draft. The configuration is written to the database only after Execute."
        : configuration?.isDraft
          ? "This is still a local draft, so Process/Menu can be changed until the first Execute."
          : "Process/Menu is locked after the first Execute. Edit approvers or status, then Execute to save."}
      onClose={onClose}
    >
      <div className={styles.modalBody}>
        {localError ? <div className="ui-alert ui-alert-error">{localError}</div> : null}

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Process / Menu</span>
            {processEditable ? (
              <select value={menuId} disabled={disabled} onChange={(event) => setMenuId(event.target.value)}>
                <option value="">Select process</option>
                {menuOptions.map((menu) => (
                  <option key={menu.id} value={menu.id}>{menu.menuName}</option>
                ))}
              </select>
            ) : (
              <div className={styles.readOnlyProcess}>
                <strong>{configuration?.menu.menuName ?? "—"}</strong>
                <small>{configuration?.menu.menuCode ?? ""}</small>
              </div>
            )}
          </label>

          <label className={styles.field}>
            <span>Status</span>
            <select
              value={activeFlag ? "ACTIVE" : "INACTIVE"}
              disabled={disabled}
              onChange={(event) => setActiveFlag(event.target.value === "ACTIVE")}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        </div>

        <div className={styles.approverField}>
          <div className={styles.approverFieldLabel}>
            <span>Approvers</span>
            <small>ANY ONE approval: one configured approver decision is enough.</small>
          </div>
          <ApproverSelector
            options={approverUsers}
            selected={selectedApprovers}
            selectedIds={approverUserIds}
            onChange={setApproverUserIds}
            disabled={disabled}
          />
        </div>
      </div>

      <div className={styles.modalFooter}>
        <Button type="button" variant="secondary" onClick={onClose} disabled={disabled}>Cancel</Button>
        <Button
          type="button"
          icon={mode === "ADD" ? <Plus size={16} /> : <Check size={16} />}
          onClick={submit}
          disabled={disabled}
        >
          {mode === "ADD" ? "Add Draft" : "Apply Changes"}
        </Button>
      </div>
    </Modal>
  );
}
