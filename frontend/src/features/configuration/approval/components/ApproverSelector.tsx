"use client";

import { useMemo, useState } from "react";
import { UserRound, X } from "lucide-react";
import { SearchInput } from "@/components/ui/SearchInput";
import type { ApprovalApproverUser, ApprovalAssignedApprover } from "../types";
import styles from "../styles/approval.module.css";

type ApproverSelectorProps = {
  options: ApprovalApproverUser[];
  selected: ApprovalAssignedApprover[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
};

export function ApproverSelector({ options, selected, selectedIds, onChange, disabled = false }: ApproverSelectorProps) {
  const [search, setSearch] = useState("");
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return options;
    return options.filter((item) => [item.fullName, item.email].some((value) => value.toLowerCase().includes(keyword)));
  }, [options, search]);

  function toggle(id: string) {
    if (disabled) return;
    if (selectedSet.has(id)) onChange(selectedIds.filter((value) => value !== id));
    else onChange([...selectedIds, id]);
  }

  return (
    <div className={styles.approverSelector}>
      {selected.length > 0 ? (
        <div className={styles.selectedApprovers}>
          {selected.map((approver) => (
            <span
              key={approver.id}
              className={`${styles.selectedApprover} ${approver.eligible ? "" : styles.ineligible}`}
              title={approver.eligible ? approver.email : `${approver.email} — no longer eligible`}
            >
              <UserRound size={13} />
              <span>{approver.fullName}</span>
              {!approver.eligible ? <small>Not eligible</small> : null}
              <button type="button" disabled={disabled} onClick={() => toggle(approver.id)} aria-label={`Remove ${approver.fullName}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : <p className={styles.noSelection}>No approver selected.</p>}

      <SearchInput
        className={styles.approverSearchInput}
        value={search}
        disabled={disabled}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search eligible approvers..."
        aria-label="Search eligible approvers"
      />

      <div className={styles.approverOptions}>
        {filtered.length === 0 ? (
          <div className={styles.approverEmpty}>No eligible approver found.</div>
        ) : filtered.map((item) => (
          <label key={item.id} className={styles.approverOption}>
            <input
              type="checkbox"
              checked={selectedSet.has(item.id)}
              disabled={disabled}
              onChange={() => toggle(item.id)}
            />
            <span className={styles.approverAvatar}><UserRound size={16} /></span>
            <span>
              <strong>{item.fullName}</strong>
              <small>{item.email}</small>
            </span>
          </label>
        ))}
      </div>

      <p className={styles.approverHint}>Only Active users with access to Sign Approval can be newly assigned.</p>
    </div>
  );
}
