"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { executeBankAccountWorkspace, getBankAccountWorkspace } from "../api/bank-account.api";
import type { BankAccount, BankAccountStatusFilter, SupportedBank } from "../types";
import {
  bankAccountsAreDirty,
  buildBankAccountPayload,
  canonicalAccountNo,
  filterBankAccounts,
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

  function addDraft(input: { bankCode: string; accountNo: string; accountName: string; activeFlag: boolean }) {
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
      statementCount: 0,
      updatedBy: null,
      isDraft: true
    }]);
    setError("");
    setMessage("Bank Account added to local workspace. Execute to save.");
    return true;
  }

  function updateAccount(id: string, input: { bankCode?: string; accountNo?: string; accountName: string; activeFlag: boolean }) {
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
          activeFlag: input.activeFlag
        };
      }
      return { ...row, accountName: input.accountName, activeFlag: input.activeFlag };
    }));
    setError("");
    setMessage("");
  }

  function removeDraft(id: string) {
    setWorkingAccounts((current) => current.filter((row) => row.id !== id || !row.isDraft));
    setError("");
    setMessage("Draft Bank Account removed.");
  }

  async function executeChanges() {
    const validation = validateBankAccountWorkspace(workingAccounts, supportedBanks);
    if (validation) {
      setError(validation);
      setMessage("");
      return false;
    }
    if (!dirty) {
      setError("");
      setMessage("No changes to execute.");
      return true;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = buildBankAccountPayload(serverAccounts, workingAccounts);
      const result = await executeBankAccountWorkspace(payload);
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
    executeChanges
  };
}
