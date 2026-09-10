"use client";
import { useCallback, useEffect, useState } from "react";
import { currentBusinessDayValue, currentBusinessMonthValue } from "@/lib/business-time";
import * as api from "../api/member-data.api";
import type { DonationQuery, DonationWorkspace } from "../types";

const today = currentBusinessDayValue(); const thisMonth = currentBusinessMonthValue();
const empty: DonationWorkspace = { member: { memberId: "", memberCode: "", memberName: "" },
  filters: { periodMode: "MONTH", month: thisMonth, date: today, eventCodeId: null, search: "" },
  summary: { lifetimeAmount: "0.00", lifetimeTransactionCount: 0, periodAmount: "0.00", periodTransactionCount: 0 },
  rows: [], eventOptions: [], eventBreakdown: [], categoryBreakdown: [], pagination: { page: 1, pageSize: 25, totalRows: 0, totalPages: 1 } };

export function useMemberDonations(memberId: string) {
  const [workspace, setWorkspace] = useState(empty);
  const [query, setQuery] = useState<DonationQuery>({ periodMode: "MONTH", month: thisMonth, date: today, eventCodeId: "", search: "", page: 1, pageSize: 25 });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [reload, setReload] = useState(0);
  useEffect(() => { const timer = setTimeout(() => setQuery(current => ({ ...current, search: search.trim(), page: 1 })), 350); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    api.getDonations(memberId, query, controller.signal).then(data => {
      if (!controller.signal.aborted) {
        setWorkspace(data);
        setQuery(current => current.page === data.pagination.page ? current : { ...current, page: data.pagination.page });
      }
    })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Gagal memuat riwayat donasi."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [memberId, query, reload]);
  const updateQuery = useCallback((next: Partial<DonationQuery>) => setQuery(current => ({ ...current, ...next, page: next.page ?? 1 })), []);
  return { workspace, query, search, setSearch, loading, error, updateQuery, reload: () => setReload(value => value + 1) };
}
