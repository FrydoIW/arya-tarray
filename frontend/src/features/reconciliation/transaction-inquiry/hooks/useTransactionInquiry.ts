"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  generateTransactionInquiryReport,
  getTransactionInquiryDetail,
  getTransactionInquiryWorkspace
} from "../api/transaction-inquiry.api";
import type {
  TransactionInquiryDetail,
  TransactionInquiryStatus,
  TransactionInquiryWorkspace,
  TransactionReportOptions
} from "../types";
import { getCurrentMonthValue } from "../utils/transaction-inquiry.utils";

const CURRENT_MONTH = getCurrentMonthValue();
const EMPTY_WORKSPACE: TransactionInquiryWorkspace = {
  filters: { month: CURRENT_MONTH, search: "", status: "ALL", bankAccountId: null },
  summary: { totalTransactions: 0, totalCredit: "0.00", totalDebit: "0.00", completeTransactions: 0, incomingTransactions: 0, outgoingTransactions: 0 },
  bankAccounts: [],
  transactions: [],
  pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 }
};

export function useTransactionInquiry() {
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TransactionInquiryStatus>("ALL");
  const [bankAccountId, setBankAccountId] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [workspace, setWorkspace] = useState<TransactionInquiryWorkspace>(EMPTY_WORKSPACE);
  const [detail, setDetail] = useState<TransactionInquiryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const query = useMemo(() => ({ month, search, status, bankAccountId, page, pageSize }), [bankAccountId, month, page, pageSize, search, status]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await getTransactionInquiryWorkspace(query);
      setWorkspace(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load Transaction Inquiry.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  function changeMonth(value: string) { setMonth(value); setPage(1); }
  function changeStatus(value: TransactionInquiryStatus) { setStatus(value); setPage(1); }
  function changeBankAccount(value: string) { setBankAccountId(value); setPage(1); }
  function changePageSize(value: number) { setPageSize(value); setPage(1); }

  async function openDetail(transactionId: string) {
    setDetailLoading(true);
    setError("");
    try {
      setDetail(await getTransactionInquiryDetail(transactionId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load transaction detail.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function generateReport(options: TransactionReportOptions) {
    setReportLoading(true);
    setError("");
    try {
      const result = await generateTransactionInquiryReport({ month, search, status, bankAccountId }, options);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to generate PDF report.");
      return false;
    } finally {
      setReportLoading(false);
    }
  }

  return {
    month,
    maxMonth: CURRENT_MONTH,
    searchInput,
    activeSearch: search,
    status,
    bankAccountId,
    page,
    pageSize,
    workspace,
    detail,
    loading,
    detailLoading,
    reportLoading,
    error,
    setSearchInput,
    changeMonth,
    changeStatus,
    changeBankAccount,
    setPage,
    changePageSize,
    refresh: load,
    openDetail,
    closeDetail: () => setDetail(null),
    generateReport
  };
}
