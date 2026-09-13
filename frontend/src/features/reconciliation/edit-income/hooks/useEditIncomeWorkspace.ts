"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAbortError } from "@/lib/api";
import { getWorkspaceCache, invalidateWorkspaceCache, readWorkspace, workspaceCacheKey } from "@/lib/workspace-cache";
import {
  executeEditIncomeCorrection,
  getEditIncomeDetail,
  getEditIncomeWorkspace
} from "../api/edit-income.api";
import type {
  CorrectionRowStatusFilter,
  CorrectionDirectionFilter,
  EditIncomeDetail,
  EditIncomeMode,
  EditIncomePeriodMode,
  EditIncomeStatusFilter,
  EditIncomeTransaction,
  EditIncomeWorkspace,
  ManualAdjustmentInput
} from "../types";
import {
  buildCorrectionChanges,
  getCorrectionRowStatus,
  getCurrentMonthValue,
  getCurrentDayValue,
  transactionChanged
} from "../utils/edit-income.utils";

const CURRENT_MONTH = getCurrentMonthValue();
const CURRENT_DAY = getCurrentDayValue();

const EMPTY_WORKSPACE: EditIncomeWorkspace = {
  periodMode: "MONTH",
  month: CURRENT_MONTH,
  date: CURRENT_DAY,
  summary: { finalizedStatements: 0, totalTransactions: 0, pendingReapproval: 0 },
  statements: [],
  bankAccounts: []
};
const EDIT_INCOME_WORKSPACE_PREFIX = "reconciliation/edit-income/workspace";

function editIncomeWorkspaceKey(period: { mode: EditIncomePeriodMode; month: string; date: string }) {
  return workspaceCacheKey(EDIT_INCOME_WORKSPACE_PREFIX, period.mode === "DAY"
    ? { periodMode: period.mode, date: period.date }
    : { periodMode: period.mode, month: period.month });
}

export function useEditIncomeWorkspace() {
  const [periodMode, setPeriodMode] = useState<EditIncomePeriodMode>("MONTH");
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [date, setDate] = useState(CURRENT_DAY);
  const initialPeriod = { mode: "MONTH" as const, month: CURRENT_MONTH, date: CURRENT_DAY };
  const initialWorkspace = getWorkspaceCache<EditIncomeWorkspace>(editIncomeWorkspaceKey(initialPeriod))?.value ?? EMPTY_WORKSPACE;
  const [workspace, setWorkspace] = useState<EditIncomeWorkspace>(initialWorkspace);
  const [detail, setDetail] = useState<EditIncomeDetail | null>(null);
  const [draftTransactions, setDraftTransactions] = useState<EditIncomeTransaction[]>([]);
  const [loading, setLoading] = useState(initialWorkspace === EMPTY_WORKSPACE);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const workspaceRequestRef = useRef<AbortController | null>(null);
  const detailRequestRef = useRef<AbortController | null>(null);

  const [statementSearch, setStatementSearch] = useState("");
  const [statementStatusFilter, setStatementStatusFilter] = useState<EditIncomeStatusFilter>("ALL");
  const [bankAccountFilter, setBankAccountFilter] = useState("ALL");
  const [statementPage, setStatementPage] = useState(1);
  const [statementPageSize, setStatementPageSize] = useState(10);

  const [transactionSearch, setTransactionSearch] = useState("");
  const [transactionStatusFilter, setTransactionStatusFilter] = useState<CorrectionRowStatusFilter>("ALL");
  const [transactionEventCodeFilter, setTransactionEventCodeFilter] = useState("ALL");
  const [transactionDirectionFilter, setTransactionDirectionFilter] = useState<CorrectionDirectionFilter>("ALL");
  const [mode, setMode] = useState<EditIncomeMode>("INQUIRY");
  const [transactionPage, setTransactionPage] = useState(1);
  const [transactionPageSize, setTransactionPageSize] = useState(25);

  const loadWorkspace = useCallback(async (targetPeriod: { mode: EditIncomePeriodMode; month: string; date: string }, force = false, consumerSignal?: AbortSignal) => {
    const ownedController = consumerSignal ? null : new AbortController();
    if (ownedController) {
      workspaceRequestRef.current?.abort();
      workspaceRequestRef.current = ownedController;
    }
    const signal = consumerSignal ?? ownedController!.signal;
    const key = editIncomeWorkspaceKey(targetPeriod);
    const read = readWorkspace(key, (signal) => getEditIncomeWorkspace(targetPeriod, signal), { force });
    if (read.cached) setWorkspace(read.cached);
    if (!read.promise) {
      if (workspaceRequestRef.current === ownedController) workspaceRequestRef.current = null;
      return read.cached!;
    }
    const release = read.release;
    signal.addEventListener("abort", release, { once: true });
    try {
      const next = await read.promise;
      if (!signal.aborted) {
        setWorkspace(next);
      }
      return next;
    } finally {
      signal.removeEventListener("abort", release);
      release();
      if (workspaceRequestRef.current === ownedController) workspaceRequestRef.current = null;
    }
  }, []);

  const loadDetail = useCallback(async (statementId: string, options: { resetView?: boolean } = {}) => {
    const resetView = options.resetView ?? true;
    detailRequestRef.current?.abort();
    const controller = new AbortController();
    detailRequestRef.current = controller;
    setDetailLoading(true);
    setError("");
    try {
      const next = await getEditIncomeDetail(statementId, controller.signal);
      if (controller.signal.aborted) return null;
      setDetail(next);
      setDraftTransactions(next.transactions.map((item) => ({ ...item })));
      if (resetView) {
        setTransactionSearch("");
        setTransactionStatusFilter("ALL");
        setTransactionEventCodeFilter("ALL");
        setTransactionDirectionFilter("ALL");
        setMode("INQUIRY");
        setTransactionPage(1);
      }
      return next;
    } catch (caught) {
      if (!isAbortError(caught)) setError(caught instanceof Error ? caught.message : "Failed to load Edit Income detail.");
      return null;
    } finally {
      if (detailRequestRef.current === controller) {
        detailRequestRef.current = null;
        setDetailLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const targetPeriod = { mode: periodMode, month, date };
    setLoading(!getWorkspaceCache<EditIncomeWorkspace>(editIncomeWorkspaceKey(targetPeriod)));
    setError("");
    setMessage("");
    void (async () => {
      try {
        await loadWorkspace(targetPeriod, false, controller.signal);
      } catch (caught) {
        if (!controller.signal.aborted && !isAbortError(caught)) setError(caught instanceof Error ? caught.message : "Failed to load Edit Income workspace.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => { controller.abort(); workspaceRequestRef.current?.abort(); };
  }, [date, loadWorkspace, month, periodMode]);

  useEffect(() => () => detailRequestRef.current?.abort(), []);

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

  useEffect(() => { setStatementPage(1); }, [statementSearch, statementStatusFilter, bankAccountFilter, month, date, periodMode]);
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredStatements.length / statementPageSize));
    if (statementPage > maxPage) setStatementPage(maxPage);
  }, [filteredStatements.length, statementPage, statementPageSize]);

  const originalById = useMemo(
    () => new Map((detail?.transactions ?? []).map((item) => [item.id, item])),
    [detail?.transactions]
  );

  const correctionSummary = useMemo(() => ({
    modifiedTransactions: draftTransactions.filter((item) => !item.correctionAction && transactionChanged(item, originalById.get(item.id))).length,
    addedAdjustments: draftTransactions.filter((item) => item.correctionAction === "ADDED").length,
    excludedTransactions: draftTransactions.filter((item) => item.correctionAction === "EXCLUDED").length
  }), [draftTransactions, originalById]);
  const modifiedTransactions = useMemo(
    () => correctionSummary.modifiedTransactions + correctionSummary.addedAdjustments + correctionSummary.excludedTransactions,
    [correctionSummary]
  );

  const refresh = useCallback(async () => {
    if (detail && modifiedTransactions > 0) {
      setError("Unsaved corrections are still staged. Execute them or use Clear before Reload.");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await loadWorkspace({ mode: periodMode, month, date }, true);
      if (detail?.statement.id) await loadDetail(detail.statement.id, { resetView: false });
    } catch (caught) {
      if (!isAbortError(caught)) setError(caught instanceof Error ? caught.message : "Failed to reload Edit Income workspace.");
    } finally {
      setLoading(false);
    }
  }, [date, detail, loadDetail, loadWorkspace, modifiedTransactions, month, periodMode]);

  const filteredTransactions = useMemo(() => {
    const search = transactionSearch.trim().toLowerCase();
    return draftTransactions.filter((transaction) => {
      const rowStatus = getCorrectionRowStatus(transaction, originalById.get(transaction.id));
      const matchesStatus = transactionStatusFilter === "ALL" || rowStatus === transactionStatusFilter;
      const matchesEventCode = transactionEventCodeFilter === "ALL" || transaction.eventCodeId === transactionEventCodeFilter;
      const direction = transaction.originalAmount.trim().startsWith("-") ? "OUTGOING" : "INCOMING";
      const matchesDirection = transactionDirectionFilter === "ALL" || direction === transactionDirectionFilter;
      const matchesSearch = !search || [
        transaction.description,
        transaction.referenceNo ?? "",
        transaction.senderName ?? "",
        transaction.transactionType,
        transaction.remark ?? ""
      ].some((value) => value.toLowerCase().includes(search));
      return matchesStatus && matchesEventCode && matchesDirection && matchesSearch;
    });
  }, [draftTransactions, originalById, transactionDirectionFilter, transactionEventCodeFilter, transactionSearch, transactionStatusFilter]);

  useEffect(() => { setTransactionPage(1); }, [transactionSearch, transactionStatusFilter, transactionEventCodeFilter, transactionDirectionFilter]);
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredTransactions.length / transactionPageSize));
    if (transactionPage > maxPage) setTransactionPage(maxPage);
  }, [filteredTransactions.length, transactionPage, transactionPageSize]);

  const canEdit = Boolean(mode === "EDIT" && detail?.statement.editable && !busy && !detailLoading);
  const canExecute = Boolean(canEdit && modifiedTransactions > 0);

  function changePeriod(value: { mode: EditIncomePeriodMode; month: string; date: string }) {
    if (busy || detail) return;
    setPeriodMode(value.mode);
    setMonth(value.month);
    setDate(value.date);
    setStatementSearch("");
    setStatementStatusFilter("ALL");
    setBankAccountFilter("ALL");
    setStatementPage(1);
  }

  function clearChanges() {
    if (!detail || busy) return;
    setDraftTransactions(detail.transactions.map((item) => ({ ...item })));
    setMode("INQUIRY");
    setMessage("Unsaved Edit Income changes cleared.");
    setError("");
  }

  function updateTransaction(transactionId: string, field: "eventCodeId" | "eventCampaignId" | "remark", value: string | null) {
    if (!canEdit) return;
    setMessage("");
    setError("");
    setDraftTransactions((current) => current.map((transaction) =>
      transaction.id === transactionId ? { ...transaction, [field]: value, ...(field === "eventCodeId" && value !== transaction.eventCodeId ? { eventCampaignId: null } : {}) } : transaction
    ));
  }

  function enterEditMode() {
    if (!detail?.statement.editable || busy || detailLoading) return;
    setMode("EDIT");
    setMessage("");
    setError("");
  }

  function enterInquiryMode() {
    if (busy || mode === "INQUIRY") return;
    if (modifiedTransactions > 0) {
      setError("Unsaved corrections are still staged. Execute them or use Clear before returning to Inquiry.");
      return;
    }
    setMode("INQUIRY");
    setMessage("");
    setError("");
  }

  function addAdjustment(input: ManualAdjustmentInput) {
    if (!canEdit) return;
    const amount = input.direction === "OUTGOING" ? `-${input.amount}` : input.amount;
    setDraftTransactions((current) => [...current, {
      id: crypto.randomUUID(),
      rowNo: 0,
      transactionDate: input.transactionDate,
      transactionType: input.direction === "INCOMING" ? "CR" : "DB",
      referenceNo: null,
      senderName: null,
      description: input.description.trim(),
      originalAmount: amount,
      suffixCode: null,
      suggestedEventCodeId: null,
      eventCodeId: input.eventCodeId,
      eventCampaignId: input.eventCampaignId,
      baseAmount: input.direction === "INCOMING" ? input.amount : null,
      remark: input.remark,
      requiresClassification: input.direction === "INCOMING",
      sourceType: "MANUAL",
      correctionReason: input.reason.trim(),
      reconciliationExcludedAt: null,
      reconciliationExclusionReason: null,
      correctionAction: "ADDED"
    }]);
    setMessage("");
    setError("");
  }

  function excludeTransaction(transactionId: string, reason: string) {
    if (!canEdit || !reason.trim()) return;
    setDraftTransactions((current) => current.map((transaction) => transaction.id === transactionId
      ? { ...transaction, correctionAction: "EXCLUDED", correctionReason: reason.trim() }
      : transaction));
    setMessage("");
    setError("");
  }

  function restoreTransaction(transactionId: string) {
    if (!canEdit) return;
    setDraftTransactions((current) => current.flatMap((transaction) => {
      if (transaction.id !== transactionId) return [transaction];
      if (transaction.correctionAction === "ADDED") return [];
      const original = originalById.get(transactionId);
      return [original ? { ...original } : transaction];
    }));
  }

  async function selectStatement(statementId: string) {
    if (busy || detail?.statement.id === statementId) return;
    if (detail && modifiedTransactions > 0) {
      setError("Unsaved corrections are still staged. Execute them or use Clear before opening another statement.");
      return;
    }
    setMessage("");
    await loadDetail(statementId);
  }

  function closeDetail() {
    if (busy) return;
    if (modifiedTransactions > 0) {
      setError("Unsaved corrections are still staged. Execute them or use Clear before leaving this statement.");
      return;
    }
    setDetail(null);
    setDraftTransactions([]);
    setTransactionSearch("");
    setTransactionStatusFilter("ALL");
    setTransactionEventCodeFilter("ALL");
    setTransactionDirectionFilter("ALL");
    setMode("INQUIRY");
    setMessage("");
    setError("");
  }

  async function execute() {
    if (!detail || !canExecute) return;
    const corrections = buildCorrectionChanges(detail, draftTransactions);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await executeEditIncomeCorrection(detail.statement.id, corrections);
      invalidateWorkspaceCache(EDIT_INCOME_WORKSPACE_PREFIX);
      invalidateWorkspaceCache("monitoring/dashboard/workspace");
      invalidateWorkspaceCache("member/data/workspace");
      invalidateWorkspaceCache("approval/sign-approval/workspace");
      invalidateWorkspaceCache("reconciliation/transaction-inquiry/workspace");
      await loadWorkspace({ mode: periodMode, month, date }, true);
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
    period: { mode: periodMode, month, date },
    maxMonth: CURRENT_MONTH,
    maxDate: CURRENT_DAY,
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
    transactionEventCodeFilter,
    transactionDirectionFilter,
    mode,
    transactionPage,
    transactionPageSize,
    filteredTransactions,
    allTransactions: draftTransactions,
    originalById,
    modifiedTransactions,
    correctionSummary,
    canEdit,
    canExecute,
    changePeriod,
    setStatementSearch,
    setStatementStatusFilter,
    setBankAccountFilter,
    setStatementPage,
    setStatementPageSize,
    setTransactionSearch,
    setTransactionStatusFilter,
    setTransactionEventCodeFilter,
    setTransactionDirectionFilter,
    setTransactionPage,
    setTransactionPageSize,
    refresh,
    selectStatement,
    closeDetail,
    clearChanges,
    enterEditMode,
    enterInquiryMode,
    updateTransaction,
    addAdjustment,
    excludeTransaction,
    restoreTransaction,
    execute
  };
}
