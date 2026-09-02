"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  executeEditIncomeCorrection,
  getEditIncomeDetail,
  getEditIncomeWorkspace
} from "../api/edit-income.api";
import type {
  CorrectionRowStatusFilter,
  EditIncomeDetail,
  EditIncomeStatusFilter,
  EditIncomeTransaction,
  EditIncomeWorkspace
} from "../types";
import {
  buildCorrectionChanges,
  getCorrectionRowStatus,
  getCurrentMonthValue,
  transactionChanged
} from "../utils/edit-income.utils";

const CURRENT_MONTH = getCurrentMonthValue();

const EMPTY_WORKSPACE: EditIncomeWorkspace = {
  month: CURRENT_MONTH,
  summary: { finalizedStatements: 0, totalTransactions: 0, pendingReapproval: 0 },
  statements: [],
  bankAccounts: []
};

export function useEditIncomeWorkspace() {
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [workspace, setWorkspace] = useState<EditIncomeWorkspace>(EMPTY_WORKSPACE);
  const [detail, setDetail] = useState<EditIncomeDetail | null>(null);
  const [draftTransactions, setDraftTransactions] = useState<EditIncomeTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [statementSearch, setStatementSearch] = useState("");
  const [statementStatusFilter, setStatementStatusFilter] = useState<EditIncomeStatusFilter>("ALL");
  const [bankAccountFilter, setBankAccountFilter] = useState("ALL");
  const [statementPage, setStatementPage] = useState(1);
  const [statementPageSize, setStatementPageSize] = useState(10);

  const [transactionSearch, setTransactionSearch] = useState("");
  const [transactionStatusFilter, setTransactionStatusFilter] = useState<CorrectionRowStatusFilter>("ALL");
  const [transactionPage, setTransactionPage] = useState(1);
  const [transactionPageSize, setTransactionPageSize] = useState(25);

  const loadWorkspace = useCallback(async (targetMonth: string) => {
    const next = await getEditIncomeWorkspace(targetMonth);
    setWorkspace(next);
    return next;
  }, []);

  const loadDetail = useCallback(async (statementId: string) => {
    setDetailLoading(true);
    setError("");
    try {
      const next = await getEditIncomeDetail(statementId);
      setDetail(next);
      setDraftTransactions(next.transactions.map((item) => ({ ...item })));
      setTransactionSearch("");
      setTransactionStatusFilter("ALL");
      setTransactionPage(1);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load Edit Income detail.");
      return null;
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await loadWorkspace(month);
      if (detail?.statement.id) await loadDetail(detail.statement.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to reload Edit Income workspace.");
    } finally {
      setLoading(false);
    }
  }, [detail?.statement.id, loadDetail, loadWorkspace, month]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setMessage("");
    void (async () => {
      try {
        const next = await getEditIncomeWorkspace(month);
        if (active) setWorkspace(next);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Failed to load Edit Income workspace.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [month]);

  const filteredStatements = useMemo(() => {
    const search = statementSearch.trim().toLowerCase();
    return workspace.statements.filter((statement) => {
      const matchesStatus = statementStatusFilter === "ALL" || statement.displayStatus === statementStatusFilter;
      const matchesBank = bankAccountFilter === "ALL" || statement.bankAccount.id === bankAccountFilter;
      const matchesSearch = !search || [
        statement.id,
        statement.fileName,
        statement.bankAccount.bankName,
        statement.bankAccount.accountNo,
        statement.bankAccount.accountName
      ].some((value) => value.toLowerCase().includes(search));
      return matchesStatus && matchesBank && matchesSearch;
    });
  }, [bankAccountFilter, statementSearch, statementStatusFilter, workspace.statements]);

  useEffect(() => { setStatementPage(1); }, [statementSearch, statementStatusFilter, bankAccountFilter, month]);
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredStatements.length / statementPageSize));
    if (statementPage > maxPage) setStatementPage(maxPage);
  }, [filteredStatements.length, statementPage, statementPageSize]);

  const originalById = useMemo(
    () => new Map((detail?.transactions ?? []).map((item) => [item.id, item])),
    [detail?.transactions]
  );

  const modifiedTransactions = useMemo(
    () => draftTransactions.filter((item) => transactionChanged(item, originalById.get(item.id))).length,
    [draftTransactions, originalById]
  );

  const filteredTransactions = useMemo(() => {
    const search = transactionSearch.trim().toLowerCase();
    return draftTransactions.filter((transaction) => {
      const rowStatus = getCorrectionRowStatus(transaction, originalById.get(transaction.id));
      const matchesStatus = transactionStatusFilter === "ALL" || rowStatus === transactionStatusFilter;
      const matchesSearch = !search || [
        transaction.description,
        transaction.referenceNo ?? "",
        transaction.senderName ?? "",
        transaction.transactionType,
        transaction.remark ?? ""
      ].some((value) => value.toLowerCase().includes(search));
      return matchesStatus && matchesSearch;
    });
  }, [draftTransactions, originalById, transactionSearch, transactionStatusFilter]);

  useEffect(() => { setTransactionPage(1); }, [transactionSearch, transactionStatusFilter]);
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredTransactions.length / transactionPageSize));
    if (transactionPage > maxPage) setTransactionPage(maxPage);
  }, [filteredTransactions.length, transactionPage, transactionPageSize]);

  const canEdit = Boolean(detail?.statement.editable && !busy && !detailLoading);
  const canExecute = Boolean(canEdit && modifiedTransactions > 0);

  function changeMonth(value: string) {
    if (busy || detail) return;
    setMonth(value);
    setStatementSearch("");
    setStatementStatusFilter("ALL");
    setBankAccountFilter("ALL");
    setStatementPage(1);
  }

  function clearChanges() {
    if (!detail || busy) return;
    setDraftTransactions(detail.transactions.map((item) => ({ ...item })));
    setMessage("Unsaved Edit Income changes cleared.");
    setError("");
  }

  function updateTransaction(transactionId: string, field: "eventCodeId" | "remark", value: string | null) {
    if (!canEdit) return;
    setMessage("");
    setError("");
    setDraftTransactions((current) => current.map((transaction) =>
      transaction.id === transactionId ? { ...transaction, [field]: value } : transaction
    ));
  }

  async function selectStatement(statementId: string) {
    if (busy) return;
    setMessage("");
    await loadDetail(statementId);
  }

  function closeDetail() {
    if (busy) return;
    setDetail(null);
    setDraftTransactions([]);
    setTransactionSearch("");
    setTransactionStatusFilter("ALL");
    setMessage("");
    setError("");
  }

  async function execute() {
    if (!detail || !canExecute) return;
    const changes = buildCorrectionChanges(detail, draftTransactions);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await executeEditIncomeCorrection(detail.statement.id, changes);
      await loadWorkspace(month);
      setDetail(null);
      setDraftTransactions([]);
      setMessage(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to submit Edit Income correction.");
    } finally {
      setBusy(false);
    }
  }

  return {
    month,
    maxMonth: CURRENT_MONTH,
    workspace,
    detail,
    loading,
    detailLoading,
    busy,
    error,
    message,
    statementSearch,
    statementStatusFilter,
    bankAccountFilter,
    statementPage,
    statementPageSize,
    filteredStatements,
    transactionSearch,
    transactionStatusFilter,
    transactionPage,
    transactionPageSize,
    filteredTransactions,
    originalById,
    modifiedTransactions,
    canEdit,
    canExecute,
    changeMonth,
    setStatementSearch,
    setStatementStatusFilter,
    setBankAccountFilter,
    setStatementPage,
    setStatementPageSize,
    setTransactionSearch,
    setTransactionStatusFilter,
    setTransactionPage,
    setTransactionPageSize,
    refresh,
    selectStatement,
    closeDetail,
    clearChanges,
    updateTransaction,
    execute
  };
}
