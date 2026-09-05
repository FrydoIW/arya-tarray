"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAbortError } from "@/lib/api";
import {
  generateTransactionInquiryReport,
  getTransactionInquiryDetail,
  getTransactionInquiryMemberOptions,
  getTransactionInquiryWorkspace
} from "../api/transaction-inquiry.api";
import type {
  TransactionInquiryDetail,
  TransactionInquiryMember,
  TransactionInquiryMemberLinkStatus,
  TransactionInquiryPeriodMode,
  TransactionInquiryStatus,
  TransactionInquiryWorkspace,
  TransactionReportOptions
} from "../types";
import { getCurrentDayValue, getCurrentMonthValue } from "../utils/transaction-inquiry.utils";

const CURRENT_MONTH = getCurrentMonthValue();
const CURRENT_DAY = getCurrentDayValue();
const EMPTY_WORKSPACE: TransactionInquiryWorkspace = {
  filters: { periodMode: "MONTH", month: CURRENT_MONTH, date: CURRENT_DAY, search: "", status: "ALL", bankAccountId: null, finalEventId: null, memberId: null, memberLinkStatus: "ALL" },
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
  const [memberId, setMemberId] = useState("ALL");
  const [memberLinkStatus, setMemberLinkStatus] = useState<TransactionInquiryMemberLinkStatus>("ALL");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberOptions, setMemberOptions] = useState<TransactionInquiryMember[]>([]);
  const [selectedMember, setSelectedMember] = useState<TransactionInquiryMember | null>(null);
  const [memberOptionsLoading, setMemberOptionsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [workspace, setWorkspace] = useState<TransactionInquiryWorkspace>(EMPTY_WORKSPACE);
  const [detail, setDetail] = useState<TransactionInquiryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState("");
  const workspaceRequestRef = useRef<AbortController | null>(null);
  const detailRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setMemberOptionsLoading(true);
      try {
        const result = await getTransactionInquiryMemberOptions(memberSearch, controller.signal);
        if (!controller.signal.aborted) setMemberOptions(result.members);
      } catch (caught) {
        if (!isAbortError(caught)) setError(caught instanceof Error ? caught.message : "Failed to load Member options.");
      } finally {
        if (!controller.signal.aborted) setMemberOptionsLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [memberSearch]);

  const query = useMemo(() => ({ periodMode, month, date, search, status, bankAccountId, finalEventId, memberId, memberLinkStatus, page, pageSize }), [bankAccountId, date, finalEventId, memberId, memberLinkStatus, month, page, pageSize, periodMode, search, status]);

  const load = useCallback(async () => {
    workspaceRequestRef.current?.abort();
    const controller = new AbortController();
    workspaceRequestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const next = await getTransactionInquiryWorkspace(query, controller.signal);
      if (!controller.signal.aborted) setWorkspace(next);
    } catch (caught) {
      if (!isAbortError(caught)) setError(caught instanceof Error ? caught.message : "Failed to load Transaction Inquiry.");
    } finally {
      if (workspaceRequestRef.current === controller) {
        workspaceRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [query]);

  useEffect(() => {
    void load();
    return () => workspaceRequestRef.current?.abort();
  }, [load]);

  useEffect(() => () => detailRequestRef.current?.abort(), []);

  function changePeriod(value: { mode: TransactionInquiryPeriodMode; month: string; date: string }) {
    setPeriodMode(value.mode);
    setMonth(value.month);
    setDate(value.date);
    setPage(1);
  }
  function changeStatus(value: TransactionInquiryStatus) { setStatus(value); setPage(1); }
  function changeBankAccount(value: string) { setBankAccountId(value); setPage(1); }
  function changeFinalEvent(value: string) { setFinalEventId(value); setPage(1); }
  function changeMember(value: string) {
    setMemberId(value);
    setSelectedMember(value === "ALL" ? null : memberOptions.find((item) => item.memberId === value) ?? null);
    setPage(1);
  }
  function changeMemberLinkStatus(value: TransactionInquiryMemberLinkStatus) { setMemberLinkStatus(value); setPage(1); }
  function changePageSize(value: number) { setPageSize(value); setPage(1); }

  async function openDetail(transactionId: string) {
    detailRequestRef.current?.abort();
    const controller = new AbortController();
    detailRequestRef.current = controller;
    setDetailLoading(true);
    setError("");
    try {
      const next = await getTransactionInquiryDetail(transactionId, controller.signal);
      if (!controller.signal.aborted) setDetail(next);
    } catch (caught) {
      if (!isAbortError(caught)) setError(caught instanceof Error ? caught.message : "Failed to load transaction detail.");
    } finally {
      if (detailRequestRef.current === controller) {
        detailRequestRef.current = null;
        setDetailLoading(false);
      }
    }
  }

  async function generateReport(options: TransactionReportOptions) {
    setReportLoading(true);
    setError("");
    try {
      const result = await generateTransactionInquiryReport({ periodMode, month, date, search, status, bankAccountId, finalEventId, memberId, memberLinkStatus }, options);
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
    memberId,
    memberLinkStatus,
    memberSearch,
    memberOptions,
    selectedMember,
    memberOptionsLoading,
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
    setMemberSearch,
    changeMember,
    changeMemberLinkStatus,
    setPage,
    changePageSize,
    refresh: load,
    openDetail,
    closeDetail: () => setDetail(null),
    generateReport
  };
}
