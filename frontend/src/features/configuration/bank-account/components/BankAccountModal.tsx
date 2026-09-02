"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { BankAccount, SupportedBank } from "../types";
import { canonicalAccountNo } from "../utils/bank-account-workspace.utils";
import styles from "../styles/bank-account.module.css";

type BankAccountModalProps = {
  open: boolean;
  mode: "ADD" | "EDIT";
  account?: BankAccount | null;
  supportedBanks: SupportedBank[];
  disabled?: boolean;
  onClose: () => void;
  onSubmit: (value: { bankCode?: string; accountNo?: string; accountName: string; activeFlag: boolean }) => void;
};

export function BankAccountModal({
  open,
  mode,
  account,
  supportedBanks,
  disabled = false,
  onClose,
  onSubmit
}: BankAccountModalProps) {
  const [bankCode, setBankCode] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [accountName, setAccountName] = useState("");
  const [activeFlag, setActiveFlag] = useState(true);
  const [localError, setLocalError] = useState("");
  const identityEditable = mode === "ADD" || Boolean(account?.isDraft);

  useEffect(() => {
    if (!open) return;
    setBankCode(account?.bankCode ?? supportedBanks[0]?.bankCode ?? "");
    setAccountNo(account?.accountNo ?? "");
    setAccountName(account?.accountName ?? "");
    setActiveFlag(account?.activeFlag ?? true);
    setLocalError("");
  }, [account, open, supportedBanks]);

  const bank = useMemo(
    () => supportedBanks.find((item) => item.bankCode === bankCode),
    [bankCode, supportedBanks]
  );

  function submit() {
    if (identityEditable && !bankCode) {
      setLocalError("Bank wajib dipilih.");
      return;
    }
    if (identityEditable && accountNo.replace(/\D/g, "").length !== 10) {
      setLocalError("BCA Account Number harus terdiri dari 10 digit.");
      return;
    }
    if (!accountName.trim()) {
      setLocalError("Account Name wajib diisi.");
      return;
    }

    setLocalError("");
    onSubmit({
      bankCode: identityEditable ? bankCode : undefined,
      accountNo: identityEditable ? canonicalAccountNo(accountNo) : undefined,
      accountName: accountName.trim(),
      activeFlag
    });
  }

  return (
    <Modal
      open={open}
      title={mode === "ADD" ? "Add Bank Account" : "Edit Bank Account"}
      description={identityEditable
        ? "Create a local draft. Bank Account is written to the database only after Execute."
        : "Bank and Account Number are locked after the first Execute to preserve statement history identity."}
      onClose={onClose}
    >
      <div className={styles.modalBody}>
        {localError ? <div className="ui-alert ui-alert-error">{localError}</div> : null}

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Bank</span>
            {identityEditable ? (
              <select value={bankCode} disabled={disabled} onChange={(event) => setBankCode(event.target.value)}>
                <option value="">Select bank</option>
                {supportedBanks.map((item) => (
                  <option key={item.bankCode} value={item.bankCode}>{item.bankCode} - {item.bankName}</option>
                ))}
              </select>
            ) : (
              <div className={styles.readOnlyField}><strong>{account?.bankCode}</strong><small>{account?.bankName}</small></div>
            )}
          </label>

          <label className={styles.field}>
            <span>Currency</span>
            <div className={styles.readOnlyField}><strong>{bank?.currencyCode ?? account?.currencyCode ?? "IDR"}</strong><small>Parser currency</small></div>
          </label>

          <label className={styles.field}>
            <span>Account Number</span>
            {identityEditable ? (
              <input
                value={accountNo}
                disabled={disabled}
                placeholder="084-9999127"
                inputMode="numeric"
                onChange={(event) => setAccountNo(canonicalAccountNo(event.target.value))}
              />
            ) : (
              <div className={styles.readOnlyField}><strong>{account?.accountNo}</strong><small>Stable account identity</small></div>
            )}
          </label>

          <label className={styles.field}>
            <span>Status</span>
            <select value={activeFlag ? "ACTIVE" : "INACTIVE"} disabled={disabled} onChange={(event) => setActiveFlag(event.target.value === "ACTIVE")}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        </div>

        <label className={`${styles.field} ${styles.fullField}`}>
          <span>Account Name</span>
          <input
            value={accountName}
            disabled={disabled}
            maxLength={200}
            placeholder="Arya Tarray Nusantara"
            onChange={(event) => setAccountName(event.target.value)}
          />
        </label>

        {!identityEditable && account?.statementCount ? (
          <div className={styles.identityNote}>This account is referenced by {account.statementCount} statement batch{account.statementCount === 1 ? "" : "es"}. Identity fields stay read-only.</div>
        ) : null}
      </div>

      <div className={styles.modalFooter}>
        <Button type="button" variant="secondary" onClick={onClose} disabled={disabled}>Cancel</Button>
        <Button type="button" icon={mode === "ADD" ? <Plus size={16} /> : <Check size={16} />} onClick={submit} disabled={disabled}>
          {mode === "ADD" ? "Add Draft" : "Apply Changes"}
        </Button>
      </div>
    </Modal>
  );
}
