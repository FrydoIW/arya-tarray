"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  generateTransactionInquiryReport,
  getTransactionInquiryDetail,
  getTransactionInquiryWorkspace
} from "../api/transaction-inquiry.api";
import type {
  TransactionInquiryDetail,
  TransactionInquiryPeriodMode,
  TransactionInquiryStatus,
  TransactionInquiryWorkspace,
  TransactionReportOptions
} from "../types";
import { getCurrentDayValue, getCurrentMonthValue } from "../utils/transaction-inquiry.utils";

const CURRENT_MONTH = getCurrentMonthValue();
const CURRENT_DAY = getCurrentDayValue();
const EMPTY_WORKSPACE: TransactionInquiryWorkspace = {
  filters: { periodMode: "MONTH", month: CURRENT_MONTH, date: CURRENT_DAY, search: "", status: "ALL", bankAccountId: null, finalEventId: null },
  summary: { totalTransactions: 0, totalCredit: "0.00", totalDebit: "0.00", completeTransactions: 0, incomingTransactions: 0, outgoingTransactions: 0 },
  bankAccounts: [],
  eventOptions: [],
  transactions: [],
  pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 }
};

export function useTransactionInquiry() {
  const [periodMode, setPeriodMode] = useState<TransactionInquiryPeriodMode>("MONTH");
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [date, setDate] = useState(CURRENT_DAY);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TransactionInquiryStatus>("ALL");
  const [bankAccountId, setBankAccountId] = useState("ALL");
  const [finalEventId, setFinalEventId] = useState("ALL");
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

  const query = useMemo(() => ({ periodMode, month, date, search, status, bankAccountId, finalEventId, page, pageSize }), [bankAccountId, date, finalEventId, month, page, pageSize, periodMode, search, status]);

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

  function changePeriod(value: { mode: TransactionInquiryPeriodMode; month: string; date: string }) {
    setPeriodMode(value.mode);
    setMonth(value.month);
    setDate(value.date);
    setPage(1);
  }
  function changeStatus(value: TransactionInquiryStatus) { setStatus(value); setPage(1); }
  function changeBankAccount(value: string) { setBankAccountId(value); setPage(1); }
  function changeFinalEvent(value: string) { setFinalEventId(value); setPage(1); }
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
      const result = await generateTransactionInquiryReport({ periodMode, month, date, search, status, bankAccountId, finalEventId }, options);
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
    period: { mode: periodMode, month, date },
    maxMonth: CURRENT_MONTH,
    maxDate: CURRENT_DAY,
    searchInput,
    activeSearch: search,
    status,
    bankAccountId,
    finalEventId,
    page,
    pageSize,
    workspace,
    detail,
    loading,
    detailLoading,
    reportLoading,
    error,
    setSearchInput,
    changePeriod,
    changeStatus,
    changeBankAccount,
    changeFinalEvent,
    setPage,
    changePageSize,
    refresh: load,
    openDetail,
    closeDetail: () => setDetail(null),
    generateReport
  };
}
