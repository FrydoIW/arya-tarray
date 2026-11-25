"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiRequestError, isAbortError } from "@/lib/api";
import { getWorkspaceCache, invalidateWorkspaceCache, readWorkspace, setWorkspaceCache, workspaceCacheKey } from "@/lib/workspace-cache";
import { invalidateMonitoringWorkspaces } from "@/lib/monitoring-cache";
import {
  executeStatementDraft,
  getStatementUploadWorkspace,
  resolveStatementDuplicate,
  uploadStatement,
  updateDraftTransactionFinalEvent,
  withdrawStatementDraft
} from "../api/statement-upload.api";
import type { DraftRowStatusFilter, StatementUploadWorkspace, UploadAttemptResult } from "../types";
import { autoSelectChildId, getDraftRowStatus, requiresEventClassification } from "../utils/statement-upload.utils";

const EMPTY_WORKSPACE: StatementUploadWorkspace = {
  summary: { draftStatements: 0, totalTransactions: 0, needsReview: 0, readyForSubmission: 0 },
  drafts: [],
  statement: null,
  transactions: [],
  duplicates: [],
  duplicateSummary: { pendingReview: 0, exactSkipped: 0, resolvedDistinct: 0, resolvedDuplicate: 0 },
  eventCodes: [],
  eventCodeChildren: [],
  campaigns: [],
  bankAccounts: []
};
const STATEMENT_WORKSPACE_PREFIX = "reconciliation/statement-upload/workspace";
const WORKSPACE_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 120_000;

function workspaceError(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "Statement Upload workspace did not respond. Use Reload to try again.";
  }
  return error instanceof Error ? error.message : fallback;
}

function statementWorkspaceKey(statementId?: string) {
  return workspaceCacheKey(STATEMENT_WORKSPACE_PREFIX, statementId ? { statementId } : undefined);
}

export function useStatementUploadWorkspace() {
  const initialWorkspace = getWorkspaceCache<StatementUploadWorkspace>(statementWorkspaceKey())?.value ?? EMPTY_WORKSPACE;
  const [workspace, setWorkspace] = useState<StatementUploadWorkspace>(initialWorkspace);
  const selectedStatementId = useRef<string | undefined>(undefined);
  const [loading, setLoading] = useState(initialWorkspace === EMPTY_WORKSPACE);
  const [actionBusy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const busy = actionBusy || uploading;
  const [withdrawing, setWithdrawing] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadAttemptResult | null>(null);
  const [savingTransactionId, setSavingTransactionId] = useState<string | null>(null);
  const [resolvingDuplicateId, setResolvingDuplicateId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DraftRowStatusFilter>("ALL");
  const [eventCodeFilter, setEventCodeFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const workspaceRequestRef = useRef<AbortController | null>(null);
  const uploadRequestRef = useRef<AbortController | null>(null);

  const loadWorkspace = useCallback(async (statementId?: string, force = false, consumerSignal?: AbortSignal) => {
    const ownedController = consumerSignal ? null : new AbortController();
    if (ownedController) {
      workspaceRequestRef.current?.abort();
      workspaceRequestRef.current = ownedController;
    }
    const signal = consumerSignal ?? ownedController!.signal;
    const key = statementWorkspaceKey(statementId);
    const read = readWorkspace(key, (signal) => getStatementUploadWorkspace(
      statementId, AbortSignal.any([signal, AbortSignal.timeout(WORKSPACE_TIMEOUT_MS)])
    ), { force });
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

  const loadDraftOrList = useCallback(async (statementId?: string, force = false) => {
    try {
      await loadWorkspace(statementId, force);
    } catch (error) {
      if (!statementId || !(error instanceof ApiRequestError) || error.status !== 404) throw error;
      invalidateWorkspaceCache(statementWorkspaceKey(statementId));
      selectedStatementId.current = undefined;
      setWorkspace(current => ({ ...current, statement: null, transactions: [], duplicates: [],
        duplicateSummary: EMPTY_WORKSPACE.duplicateSummary,
        drafts: current.drafts.filter(draft => draft.id !== statementId) }));
      await loadWorkspace(undefined, true);
      setMessage("The selected draft is no longer available. The draft list has been refreshed.");
    }
  }, [loadWorkspace]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await loadDraftOrList(selectedStatementId.current, true);
    } catch (caught) {
      if (!isAbortError(caught)) setError(workspaceError(caught, "Failed to load Statement Upload workspace."));
    } finally {
      setLoading(false);
    }
  }, [loadDraftOrList]);

  useEffect(() => {
    const controller = new AbortController();
    const cancelUpload = () => uploadRequestRef.current?.abort();
    window.addEventListener("pagehide", cancelUpload);
    void (async () => {
      setLoading(!getWorkspaceCache<StatementUploadWorkspace>(statementWorkspaceKey()));
      try {
        await loadWorkspace(undefined, false, controller.signal);
      } catch (caught) {
        if (!controller.signal.aborted && !isAbortError(caught)) setError(workspaceError(caught, "Failed to load Statement Upload workspace."));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      window.removeEventListener("pagehide", cancelUpload);
      controller.abort();
      workspaceRequestRef.current?.abort();
      cancelUpload();
    };
  }, [loadWorkspace]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput), 200);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const transactionCounts = useMemo(() => workspace.transactions.reduce((counts, transaction) => {
    if (getDraftRowStatus(transaction, workspace.eventCodes, workspace.eventCodeChildren) === "NEEDS_REVIEW") counts.needsReview += 1;
    else counts.resolvedTransactions += 1;
    if (requiresEventClassification(transaction)) counts.relevantIncoming += 1;
    return counts;
  }, { needsReview: 0, resolvedTransactions: 0, relevantIncoming: 0 }), [workspace.transactions, workspace.eventCodes, workspace.eventCodeChildren]);
  const { needsReview, resolvedTransactions, relevantIncoming } = transactionCounts;

  const filteredTransactions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return workspace.transactions.filter((transaction) => {
      const rowStatus = getDraftRowStatus(transaction, workspace.eventCodes, workspace.eventCodeChildren);
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
  }, [eventCodeFilter, search, statusFilter, workspace.transactions, workspace.eventCodes, workspace.eventCodeChildren]);

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
      && workspace.duplicateSummary.pendingReview === 0
  );

  async function saveTransaction(
    transactionId: string,
    payload: { eventCodeId: string | null; eventCodeChildId: string | null; eventCampaignId: string | null; remark?: string | null; itemSaleQuantity?: number | null },
    successMessage: string
  ): Promise<boolean> {
    if (!canEditDraft || savingTransactionId) return false;
    const statementId = workspace.statement?.id;
    if (!statementId) return false;
    const previousWorkspace = workspace;
    const optimisticTransactions = workspace.transactions.map((transaction) =>
      transaction.id === transactionId
        ? {
            ...transaction,
            eventCodeId: payload.eventCodeId,
            eventCodeChildId: payload.eventCodeChildId,
            eventCampaignId: payload.eventCampaignId,
            ...(payload.itemSaleQuantity !== undefined ? { itemSaleQuantity: payload.itemSaleQuantity } : {})
          }
        : transaction
    );
    const optimisticWorkspace = { ...workspace, transactions: optimisticTransactions };
    setSavingTransactionId(transactionId);
    setError("");
    setMessage("");
    setWorkspace(optimisticWorkspace);
    setWorkspaceCache(statementWorkspaceKey(statementId), optimisticWorkspace);
    try {
      const result = await updateDraftTransactionFinalEvent({ statementId, transactionId, ...payload });
      const transactions = workspace.transactions.map((transaction) =>
        transaction.id === result.transaction.id ? result.transaction : transaction
      );
      const nextWorkspace = {
        ...workspace,
        summary: result.summary,
        drafts: workspace.drafts.map((draft) => draft.id === statementId
          ? { ...draft, needsReview: transactions.filter((transaction) => getDraftRowStatus(transaction, workspace.eventCodes, workspace.eventCodeChildren) === "NEEDS_REVIEW").length }
          : draft),
        transactions
      };
      invalidateWorkspaceCache(STATEMENT_WORKSPACE_PREFIX);
      invalidateWorkspaceCache("reconciliation/transaction-inquiry/workspace");
      setWorkspaceCache(statementWorkspaceKey(statementId), nextWorkspace);
      setWorkspace(nextWorkspace);
      setMessage(successMessage);
      return true;
    } catch (caught) {
      setWorkspace(previousWorkspace);
      setWorkspaceCache(statementWorkspaceKey(statementId), previousWorkspace);
      setError(caught instanceof Error ? caught.message : "Failed to update the draft transaction.");
      return false;
    } finally {
      setSavingTransactionId(null);
    }
  }

  async function updateFinalEvent(
    transactionId: string,
    eventCodeId: string | null,
    eventCodeChildId: string | null = null,
    eventCampaignId: string | null = null
  ) {
    const transaction = workspace.transactions.find((item) => item.id === transactionId);
    const parentChanged = transaction && transaction.eventCodeId !== eventCodeId;
    const effectiveChildId = parentChanged || eventCodeChildId !== null
      ? eventCodeChildId
      : autoSelectChildId({ ...transaction!, eventCodeId }, workspace.eventCodeChildren);
    await saveTransaction(transactionId, {
      eventCodeId,
      eventCodeChildId: effectiveChildId,
      eventCampaignId: parentChanged ? null : eventCampaignId
    }, "Final Event saved.");
  }

  async function updateRemark(transactionId: string, remark: string | null) {
    const transaction = workspace.transactions.find((item) => item.id === transactionId);
    if (!transaction) return;
    await saveTransaction(transactionId, {
      eventCodeId: transaction.eventCodeId ?? null,
      eventCodeChildId: transaction.eventCodeChildId ?? null,
      eventCampaignId: transaction.eventCampaignId ?? null,
      remark
    }, "Remark saved.");
  }

  async function updateItemSaleQuantity(transactionId: string, itemSaleQuantity: number | null) {
    const transaction = workspace.transactions.find((item) => item.id === transactionId);
    if (!transaction) return false;
    return saveTransaction(transactionId, {
      eventCodeId: transaction.eventCodeId ?? null,
      eventCodeChildId: transaction.eventCodeChildId ?? null,
      eventCampaignId: transaction.eventCampaignId ?? null,
      itemSaleQuantity
    }, "Item quantity saved.");
  }

  async function upload(file: File, bankAccountId: string) {
    if (!canUpload || !bankAccountId || uploadRequestRef.current) return;
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(UPLOAD_TIMEOUT_MS);
    const signal = AbortSignal.any([controller.signal, timeout]);
    const finish = () => {
      if (uploadRequestRef.current !== controller) return;
      uploadRequestRef.current = null;
      setUploading(false);
    };
    const onAbort = () => {
      if (uploadRequestRef.current !== controller) return;
      if (timeout.aborted && !controller.signal.aborted) {
        setError("Upload timed out. Use Reload to check whether a draft was created before trying again.");
      }
      // Release the UI even if the transport has not settled its promise yet.
      finish();
    };
    uploadRequestRef.current = controller;
    signal.addEventListener("abort", onAbort, { once: true });
    setUploading(true);
    setError("");
    setMessage("");
    setUploadResult(null);
    try {
      const next = await uploadStatement({ file, bankAccountId }, signal);
      if (signal.aborted || uploadRequestRef.current !== controller) return;
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
      const { importedTransactions, sourceTransactions, duplicateTransactions, possibleDuplicateTransactions } = next.uploadResult;
      const review = possibleDuplicateTransactions > 0 ? ` ${possibleDuplicateTransactions} possible duplicate${possibleDuplicateTransactions === 1 ? "" : "s"} imported for review.` : "";
      setMessage(importedTransactions > 0
        ? `${importedTransactions} of ${sourceTransactions} source transactions imported. ${duplicateTransactions} exact duplicate${duplicateTransactions === 1 ? "" : "s"} skipped.${review}`
        : `No new transactions were imported. ${duplicateTransactions} exact duplicate transaction${duplicateTransactions === 1 ? "" : "s"} were skipped.${review}`);
    } catch (caught) {
      if (signal.aborted || uploadRequestRef.current !== controller) return;
      if (caught instanceof TypeError) {
        setError("The upload connection was interrupted. Use Reload to check for a new draft before trying again.");
      } else {
        setError(caught instanceof Error ? caught.message : "Failed to upload and parse the statement file.");
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      finish();
    }
  }

  async function resolveDuplicate(duplicateId: string, decision: "DISTINCT" | "DUPLICATE", reason: string) {
    if (!workspace.statement || resolvingDuplicateId || busy) return;
    setResolvingDuplicateId(duplicateId);
    setError("");
    setMessage("");
    try {
      const next = await resolveStatementDuplicate({ statementId: workspace.statement.id, duplicateId, decision, reason });
      invalidateWorkspaceCache(STATEMENT_WORKSPACE_PREFIX);
      invalidateWorkspaceCache("reconciliation/transaction-inquiry/workspace");
      setWorkspaceCache(statementWorkspaceKey(next.statement?.id), next);
      setWorkspace(next);
      setMessage(decision === "DISTINCT"
        ? "Duplicate review saved: the incoming transaction is kept as distinct."
        : "Duplicate confirmed: the incoming transaction was excluded from the draft and the statement totals were reduced.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to resolve the duplicate.");
    } finally {
      setResolvingDuplicateId(null);
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
      await loadDraftOrList(statementId, true);
      setSearchInput("");
      setSearch("");
      setStatusFilter("ALL");
      setEventCodeFilter("ALL");
      setPage(1);
    } catch (caught) {
      if (!isAbortError(caught)) setError(workspaceError(caught, "Failed to open statement draft."));
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
    resolvingDuplicateId,
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
    updateItemSaleQuantity,
    upload,
    resolveDuplicate,
    execute,
    withdraw
  };
}
