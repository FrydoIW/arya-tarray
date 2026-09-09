"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { invalidateWorkspaceCache } from "@/lib/workspace-cache";
import { executeBankAccountWorkspace, getBankAccountWorkspace } from "../api/bank-account.api";
import type { BankAccount, BankAccountStatusFilter, SupportedBank } from "../types";
import {
  bankAccountsAreDirty,
  buildBankAccountPayload,
  canonicalAccountNo,
  filterBankAccounts,
  rebaseBankAccountBalance,
  summarizeBankAccounts,
  validateBankAccountWorkspace
} from "../utils/bank-account-workspace.utils";

export function useBankAccountWorkspace() {
  const [serverAccounts, setServerAccounts] = useState<BankAccount[]>([]);
  const [workingAccounts, setWorkingAccounts] = useState<BankAccount[]>([]);
  const [supportedBanks, setSupportedBanks] = useState<SupportedBank[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<BankAccountStatusFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const applyWorkspace = useCallback((workspace: Awaited<ReturnType<typeof getBankAccountWorkspace>>) => {
    setServerAccounts(workspace.accounts);
    setWorkingAccounts(workspace.accounts);
    setSupportedBanks(workspace.supportedBanks);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const workspace = await getBankAccountWorkspace();
      applyWorkspace(workspace);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Bank Account workspace");
      return false;
    } finally {
      setLoading(false);
    }
  }, [applyWorkspace]);

  useEffect(() => {
    void load();
  }, [load]);

  const accounts = useMemo(
    () => filterBankAccounts(workingAccounts, search, statusFilter),
    [search, statusFilter, workingAccounts]
  );
  const summary = useMemo(
    () => summarizeBankAccounts(workingAccounts, supportedBanks),
    [supportedBanks, workingAccounts]
  );
  const dirty = useMemo(
    () => bankAccountsAreDirty(serverAccounts, workingAccounts),
    [serverAccounts, workingAccounts]
  );

  async function refresh() {
    setMessage("");
    const success = await load();
    if (success) setMessage("Bank Account workspace reloaded from database.");
    return success;
  }

  function clearChanges() {
    setWorkingAccounts(serverAccounts);
    setError("");
    setMessage("Unsaved changes cleared.");
  }

  function addDraft(input: { bankCode: string; accountNo: string; accountName: string; activeFlag: boolean; openingBalance: string | null; openingBalanceDate: string | null }) {
    const bank = supportedBanks.find((item) => item.bankCode === input.bankCode);
    if (!bank) return false;
    setWorkingAccounts((current) => [...current, {
      id: `draft-bank-${crypto.randomUUID()}`,
      bankCode: bank.bankCode,
      bankName: bank.bankName,
      accountNo: canonicalAccountNo(input.accountNo),
      accountName: input.accountName,
      currencyCode: bank.currencyCode,
      activeFlag: input.activeFlag,
      openingBalance: input.openingBalance,
      openingBalanceDate: input.openingBalanceDate,
      openingBalanceLockedAt: null,
      openingBalanceEditable: true,
      balance: {
        configured: input.openingBalance != null && input.openingBalanceDate != null,
        finalizedIncoming: input.openingBalance == null ? null : "0.00",
        finalizedOutgoing: input.openingBalance == null ? null : "0.00",
        reconciledBalance: input.openingBalance,
        pendingMovement: input.openingBalance == null ? null : "0.00"
      },
      statementCount: 0,
      updatedBy: null,
      isDraft: true
    }]);
    setError("");
    setMessage("Bank Account added to local workspace. Execute to save.");
    return true;
  }

  function updateAccount(id: string, input: { bankCode?: string; accountNo?: string; accountName: string; activeFlag: boolean; openingBalance: string | null; openingBalanceDate: string | null }) {
    setWorkingAccounts((current) => current.map((row) => {
      if (row.id !== id) return row;
      if (row.isDraft) {
        const bank = supportedBanks.find((item) => item.bankCode === input.bankCode) ?? supportedBanks.find((item) => item.bankCode === row.bankCode);
        return {
          ...row,
          bankCode: bank?.bankCode ?? row.bankCode,
          bankName: bank?.bankName ?? row.bankName,
          currencyCode: bank?.currencyCode ?? row.currencyCode,
          accountNo: canonicalAccountNo(input.accountNo ?? row.accountNo),
          accountName: input.accountName,
          activeFlag: input.activeFlag,
          openingBalance: input.openingBalance,
          openingBalanceDate: input.openingBalanceDate,
          balance: {
            ...row.balance,
            configured: input.openingBalance != null && input.openingBalanceDate != null,
            finalizedIncoming: input.openingBalance == null ? null : "0.00",
            finalizedOutgoing: input.openingBalance == null ? null : "0.00",
            reconciledBalance: input.openingBalance,
            pendingMovement: input.openingBalance == null ? null : "0.00"
          }
        };
      }
      return {
        ...row,
        accountName: input.accountName,
        activeFlag: input.activeFlag,
        openingBalance: input.openingBalance,
        openingBalanceDate: input.openingBalanceDate,
        balance: rebaseBankAccountBalance(row.balance, input.openingBalance)
      };
    }));
    setError("");
    setMessage("");
  }

  function removeDraft(id: string) {
    setWorkingAccounts((current) => current.filter((row) => row.id !== id || !row.isDraft));
    setError("");
    setMessage("Draft Bank Account removed.");
  }

  function prepareExecute() {
    const validation = validateBankAccountWorkspace(workingAccounts, supportedBanks);
    if (validation) {
      setError(validation);
      setMessage("");
      return false;
    }
    if (!dirty) {
      setError("");
      setMessage("No changes to execute.");
      return false;
    }

    return true;
  }

  async function executeChanges() {
    if (!prepareExecute()) return false;

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = buildBankAccountPayload(serverAccounts, workingAccounts);
      const result = await executeBankAccountWorkspace(payload);
      invalidateWorkspaceCache("reconciliation/statement-upload/workspace");
      invalidateWorkspaceCache("reconciliation/edit-income/workspace");
      invalidateWorkspaceCache("reconciliation/transaction-inquiry/workspace");
      applyWorkspace(result);
      setMessage(`${result.changedCount} Bank Account change${result.changedCount === 1 ? "" : "s"} successfully executed.`);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute Bank Account changes");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return {
    accounts,
    allAccounts: workingAccounts,
    supportedBanks,
    summary,
    dirty,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    loading,
    saving,
    error,
    message,
    refresh,
    clearChanges,
    addDraft,
    updateAccount,
    removeDraft,
    prepareExecute,
    executeChanges
  };
}
