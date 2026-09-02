"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  executeStatementDraft,
  getStatementUploadWorkspace,
  uploadStatement,
  updateDraftTransactionFinalEvent
} from "../api/statement-upload.api";
import type { DraftRowStatusFilter, StatementUploadWorkspace } from "../types";
import {
  countNeedsReview,
  countResolvedTransactions,
  getDraftRowStatus,
  requiresEventClassification
} from "../utils/statement-upload.utils";

const EMPTY_WORKSPACE: StatementUploadWorkspace = {
  summary: { draftStatements: 0, totalTransactions: 0, needsReview: 0, readyForSubmission: 0 },
  statement: null,
  transactions: [],
  eventCodes: [],
  bankAccounts: []
};

export function useStatementUploadWorkspace() {
  const [workspace, setWorkspace] = useState<StatementUploadWorkspace>(EMPTY_WORKSPACE);
  const selectedStatementId = useRef<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingTransactionId, setSavingTransactionId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DraftRowStatusFilter>("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const loadWorkspace = useCallback(async (statementId?: string) => {
    const next = await getStatementUploadWorkspace(statementId);
    selectedStatementId.current = next.statement?.id;
    setWorkspace(next);
    return next;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await loadWorkspace(selectedStatementId.current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load Statement Upload workspace.");
    } finally {
      setLoading(false);
    }
  }, [loadWorkspace]);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      try {
        const next = await getStatementUploadWorkspace();
        if (!active) return;
        selectedStatementId.current = next.statement?.id;
        setWorkspace(next);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Failed to load Statement Upload workspace.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const needsReview = useMemo(() => countNeedsReview(workspace.transactions), [workspace.transactions]);
  const resolvedTransactions = useMemo(() => countResolvedTransactions(workspace.transactions), [workspace.transactions]);
  const relevantIncoming = useMemo(
    () => workspace.transactions.filter(requiresEventClassification).length,
    [workspace.transactions]
  );

  const filteredTransactions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return workspace.transactions.filter((transaction) => {
      const rowStatus = getDraftRowStatus(transaction);
      const matchesStatus = statusFilter === "ALL" || rowStatus === statusFilter;
      const matchesSearch = !normalizedSearch || [
        transaction.description,
        transaction.referenceNo ?? "",
        transaction.senderName ?? "",
        transaction.transactionType
      ].some((value) => value.toLowerCase().includes(normalizedSearch));
      return matchesStatus && matchesSearch;
    });
  }, [search, statusFilter, workspace.transactions]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredTransactions.length / pageSize));
    if (page > maxPage) setPage(maxPage);
  }, [filteredTransactions.length, page, pageSize]);

  const canEditDraft = workspace.statement?.status === "RAW" && !busy;
  const canUpload = !loading && !busy;
  const canExecute = Boolean(
    canEditDraft && workspace.statement?.id && workspace.transactions.length > 0 && needsReview === 0
  );

  async function updateFinalEvent(transactionId: string, eventCodeId: string | null) {
    if (!canEditDraft || savingTransactionId) return;
    setSavingTransactionId(transactionId);
    setError("");
    setMessage("");
    try {
      const result = await updateDraftTransactionFinalEvent({ transactionId, eventCodeId });
      setWorkspace((current) => ({
        ...current,
        summary: result.summary,
        transactions: current.transactions.map((transaction) =>
          transaction.id === result.transaction.id ? result.transaction : transaction
        )
      }));
      setMessage("Final Event saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to update Final Event.");
    } finally {
      setSavingTransactionId(null);
    }
  }

  async function upload(file: File, bankAccountId: string) {
    if (!canUpload || !bankAccountId) return;
    setBusy(true);
    setUploading(true);
    setError("");
    setMessage("");
    try {
      const next = await uploadStatement({ file, bankAccountId });
      selectedStatementId.current = next.statement?.id;
      setWorkspace(next);
      setSearch("");
      setStatusFilter("ALL");
      setPage(1);
      setMessage(`${file.name} uploaded and parsed successfully. Draft data is now persisted.`);
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
      selectedStatementId.current = next.statement?.id;
      setWorkspace(next);
      setMessage("Draft submitted for approval. Status is now Pending Approval.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to submit the draft for approval.");
    } finally {
      setBusy(false);
    }
  }

  return {
    workspace,
    loading,
    busy,
    uploading,
    savingTransactionId,
    error,
    message,
    search,
    statusFilter,
    page,
    pageSize,
    filteredTransactions,
    needsReview,
    resolvedTransactions,
    relevantIncoming,
    canEditDraft,
    canUpload,
    canExecute,
    setSearch,
    setStatusFilter,
    setPage,
    setPageSize,
    refresh,
    updateFinalEvent,
    upload,
    execute
  };
}
