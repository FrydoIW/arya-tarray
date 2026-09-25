"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAbortError } from "@/lib/api";
import { getWorkspaceCache, invalidateWorkspaceCache, readWorkspace, setWorkspaceCache, workspaceCacheKey } from "@/lib/workspace-cache";
import { invalidateMonitoringWorkspaces } from "@/features/monitoring/monitoring-cache";
import {
  executeStatementDraft,
  getStatementUploadWorkspace,
  uploadStatement,
  updateDraftTransactionFinalEvent,
  withdrawStatementDraft
} from "../api/statement-upload.api";
import type { DraftRowStatusFilter, StatementUploadWorkspace, UploadAttemptResult } from "../types";
import { getDraftRowStatus, requiresEventClassification } from "../utils/statement-upload.utils";

const EMPTY_WORKSPACE: StatementUploadWorkspace = {
  summary: { draftStatements: 0, totalTransactions: 0, needsReview: 0, readyForSubmission: 0 },
  drafts: [],
  statement: null,
  transactions: [],
  eventCodes: [],
  campaigns: [],
  bankAccounts: []
};
const STATEMENT_WORKSPACE_PREFIX = "reconciliation/statement-upload/workspace";

function statementWorkspaceKey(statementId?: string) {
  return workspaceCacheKey(STATEMENT_WORKSPACE_PREFIX, statementId ? { statementId } : undefined);
}

export function useStatementUploadWorkspace() {
  const initialWorkspace = getWorkspaceCache<StatementUploadWorkspace>(statementWorkspaceKey())?.value ?? EMPTY_WORKSPACE;
  const [workspace, setWorkspace] = useState<StatementUploadWorkspace>(initialWorkspace);
  const selectedStatementId = useRef<string | undefined>(undefined);
  const [loading, setLoading] = useState(initialWorkspace === EMPTY_WORKSPACE);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadAttemptResult | null>(null);
  const [savingTransactionId, setSavingTransactionId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DraftRowStatusFilter>("ALL");
  const [eventCodeFilter, setEventCodeFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const workspaceRequestRef = useRef<AbortController | null>(null);

  const loadWorkspace = useCallback(async (statementId?: string, force = false, consumerSignal?: AbortSignal) => {
    const ownedController = consumerSignal ? null : new AbortController();
    if (ownedController) {
      workspaceRequestRef.current?.abort();
      workspaceRequestRef.current = ownedController;
    }
    const signal = consumerSignal ?? ownedController!.signal;
    const key = statementWorkspaceKey(statementId);
    const read = readWorkspace(key, (signal) => getStatementUploadWorkspace(statementId, signal), { force });
    if (read.cached) {
      selectedStatementId.current = read.cached.statement?.id;
      setWorkspace(read.cached);
    }
    if (!read.promise) {
      if (workspaceRequestRef.current === ownedController) workspaceRequestRef.current = null;
      return read.cached!;
    }
    const release = read.release;
    signal.addEventListener("abort", release, { once: true });
    try {
      const next = await read.promise;
      if (!signal.aborted) {
        selectedStatementId.current = next.statement?.id;
        setWorkspace(next);
      }
      return next;
    } finally {
      signal.removeEventListener("abort", release);
      release();
      if (workspaceRequestRef.current === ownedController) workspaceRequestRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await loadWorkspace(selectedStatementId.current, true);
    } catch (caught) {
      if (!isAbortError(caught)) setError(caught instanceof Error ? caught.message : "Failed to load Statement Upload workspace.");
    } finally {
      setLoading(false);
    }
  }, [loadWorkspace]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(!getWorkspaceCache<StatementUploadWorkspace>(statementWorkspaceKey()));
      try {
        await loadWorkspace(undefined, false, controller.signal);
      } catch (caught) {
        if (!controller.signal.aborted && !isAbortError(caught)) setError(caught instanceof Error ? caught.message : "Failed to load Statement Upload workspace.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => { controller.abort(); workspaceRequestRef.current?.abort(); };
  }, [loadWorkspace]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput), 200);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const transactionCounts = useMemo(() => workspace.transactions.reduce((counts, transaction) => {
    if (getDraftRowStatus(transaction, workspace.eventCodes) === "NEEDS_REVIEW") counts.needsReview += 1;
    else counts.resolvedTransactions += 1;
    if (requiresEventClassification(transaction)) counts.relevantIncoming += 1;
    return counts;
  }, { needsReview: 0, resolvedTransactions: 0, relevantIncoming: 0 }), [workspace.transactions, workspace.eventCodes]);
  const { needsReview, resolvedTransactions, relevantIncoming } = transactionCounts;

  const filteredTransactions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return workspace.transactions.filter((transaction) => {
      const rowStatus = getDraftRowStatus(transaction, workspace.eventCodes);
      const matchesStatus = statusFilter === "ALL" || rowStatus === statusFilter;
      const matchesEventCode = eventCodeFilter === "ALL" || transaction.eventCodeId === eventCodeFilter;
      const matchesSearch = !normalizedSearch || [
        transaction.description,
        transaction.referenceNo ?? "",
        transaction.senderName ?? "",
        transaction.transactionType
      ].some((value) => value.toLowerCase().includes(normalizedSearch));
      return matchesStatus && matchesEventCode && matchesSearch;
    });
  }, [eventCodeFilter, search, statusFilter, workspace.transactions, workspace.eventCodes]);

  useEffect(() => {
    setPage(1);
  }, [eventCodeFilter, search, statusFilter]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredTransactions.length / pageSize));
    if (page > maxPage) setPage(maxPage);
  }, [filteredTransactions.length, page, pageSize]);

  const canEditDraft = workspace.statement?.status === "RAW" && !busy;
  const canUpload = !loading && !busy;
  const canExecute = Boolean(
    canEditDraft && workspace.statement?.id && workspace.transactions.length > 0 && needsReview === 0
  );

  async function saveTransaction(
    transactionId: string,
    payload: { eventCodeId: string | null; eventCampaignId: string | null; remark?: string | null },
    successMessage: string
  ) {
    if (!canEditDraft || savingTransactionId) return;
    setSavingTransactionId(transactionId);
    setError("");
    setMessage("");
    try {
      const statementId = workspace.statement?.id;
      if (!statementId) return;
      const result = await updateDraftTransactionFinalEvent({ statementId, transactionId, ...payload });
      const transactions = workspace.transactions.map((transaction) =>
        transaction.id === result.transaction.id ? result.transaction : transaction
      );
      const nextWorkspace = {
        ...workspace,
        summary: result.summary,
        drafts: workspace.drafts.map((draft) => draft.id === statementId
          ? { ...draft, needsReview: transactions.filter((transaction) => getDraftRowStatus(transaction, workspace.eventCodes) === "NEEDS_REVIEW").length }
          : draft),
        transactions
      };
      invalidateWorkspaceCache(STATEMENT_WORKSPACE_PREFIX);
      invalidateWorkspaceCache("reconciliation/transaction-inquiry/workspace");
      setWorkspaceCache(statementWorkspaceKey(statementId), nextWorkspace);
      setWorkspace(nextWorkspace);
      setMessage(successMessage);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to update the draft transaction.");
    } finally {
      setSavingTransactionId(null);
    }
  }

  async function updateFinalEvent(transactionId: string, eventCodeId: string | null, eventCampaignId: string | null = null) {
    await saveTransaction(transactionId, { eventCodeId, eventCampaignId }, "Final Event saved.");
  }

  async function updateRemark(transactionId: string, remark: string | null) {
    const transaction = workspace.transactions.find((item) => item.id === transactionId);
    if (!transaction) return;
    await saveTransaction(transactionId, {
      eventCodeId: transaction.eventCodeId ?? null,
      eventCampaignId: transaction.eventCampaignId ?? null,
      remark
    }, "Remark saved.");
  }

  async function upload(file: File, bankAccountId: string) {
    if (!canUpload || !bankAccountId) return;
    setBusy(true);
    setUploading(true);
    setError("");
    setMessage("");
    setUploadResult(null);
    try {
      const next = await uploadStatement({ file, bankAccountId });
      invalidateWorkspaceCache(STATEMENT_WORKSPACE_PREFIX);
      invalidateMonitoringWorkspaces(["timeBased", "campaign"]);
      invalidateWorkspaceCache("member/registration/workspace");
      invalidateWorkspaceCache("reconciliation/edit-income/workspace");
      invalidateWorkspaceCache("reconciliation/transaction-inquiry/workspace");
      if (next.statement?.id) {
        selectedStatementId.current = next.statement.id;
        setWorkspaceCache(statementWorkspaceKey(next.statement.id), next);
        setWorkspace(next);
        setSearchInput("");
        setSearch("");
        setStatusFilter("ALL");
        setEventCodeFilter("ALL");
        setPage(1);
      }
      setUploadResult(next.uploadResult);
      const { importedTransactions, sourceTransactions, duplicateTransactions } = next.uploadResult;
      setMessage(importedTransactions > 0
        ? `${importedTransactions} of ${sourceTransactions} source transactions imported. ${duplicateTransactions} duplicate${duplicateTransactions === 1 ? "" : "s"} skipped.`
        : `No new transactions were imported. ${duplicateTransactions} duplicate transaction${duplicateTransactions === 1 ? "" : "s"} were skipped.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to upload and parse the statement file.");
    } finally {
      setUploading(false);
      setBusy(false);
    }
  }

  async function execute() {
    if (!canExecute || !workspace.statement) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await executeStatementDraft(workspace.statement.id);
      invalidateWorkspaceCache(STATEMENT_WORKSPACE_PREFIX);
      invalidateMonitoringWorkspaces(["timeBased", "campaign"]);
      invalidateWorkspaceCache("approval/sign-approval/workspace");
      invalidateWorkspaceCache("reconciliation/edit-income/workspace");
      invalidateWorkspaceCache("reconciliation/transaction-inquiry/workspace");
      selectedStatementId.current = next.statement?.id;
      setWorkspaceCache(statementWorkspaceKey(), next);
      setWorkspace(next);
      setMessage("Draft submitted for approval. Status is now Pending Approval.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to submit the draft for approval.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(statementId: string, reason: string): Promise<boolean> {
    if (busy || savingTransactionId) return false;
    setBusy(true);
    setWithdrawing(true);
    setError("");
    setMessage("");
    try {
      const next = await withdrawStatementDraft({ statementId, reason });
      invalidateWorkspaceCache(STATEMENT_WORKSPACE_PREFIX);
      invalidateMonitoringWorkspaces(["timeBased", "campaign"]);
      invalidateWorkspaceCache("approval/sign-approval/workspace");
      invalidateWorkspaceCache("reconciliation/edit-income/workspace");
      invalidateWorkspaceCache("reconciliation/transaction-inquiry/workspace");
      if (selectedStatementId.current === statementId) selectedStatementId.current = undefined;
      setWorkspace(next);
      setMessage("Draft withdrawn. The upload audit record was preserved.");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to withdraw the draft.");
      return false;
    } finally {
      setWithdrawing(false);
      setBusy(false);
    }
  }

  async function selectDraft(statementId: string) {
    if (busy || loading || statementId === selectedStatementId.current) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await loadWorkspace(statementId);
      setSearchInput("");
      setSearch("");
      setStatusFilter("ALL");
      setEventCodeFilter("ALL");
      setPage(1);
    } catch (caught) {
      if (!isAbortError(caught)) setError(caught instanceof Error ? caught.message : "Failed to open statement draft.");
    } finally {
      setLoading(false);
    }
  }

  return {
    workspace,
    loading,
    busy,
    uploading,
    withdrawing,
    uploadResult,
    savingTransactionId,
    error,
    message,
    search: searchInput,
    statusFilter,
    eventCodeFilter,
    page,
    pageSize,
    filteredTransactions,
    needsReview,
    resolvedTransactions,
    relevantIncoming,
    canEditDraft,
    canUpload,
    canExecute,
    selectedStatementId: workspace.statement?.id ?? null,
    setSearch: setSearchInput,
    setStatusFilter,
    setEventCodeFilter,
    setPage,
    setPageSize,
    refresh,
    selectDraft,
    updateFinalEvent,
    updateRemark,
    upload,
    execute,
    withdraw
  };
}
