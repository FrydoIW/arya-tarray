"use client";
import { useCallback, useEffect, useState } from "react";
import * as api from "../api/member-data.api";
import type { MemberDataQuery, MemberWorkspace } from "../types";
import { currentBusinessDayValue, currentBusinessMonthValue } from "@/lib/business-time";

const today = currentBusinessDayValue(); const thisMonth = currentBusinessMonthValue();
const empty: MemberWorkspace = { summary: { total: 0, active: 0, inactive: 0, manual: 0, statement: 0 },
  filters: { cities: [], periodMode: "MONTH", month: thisMonth, date: today, eventCodeId: null }, eventOptions: [], rows: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } };
export function useMemberData() {
  const [workspace, setWorkspace] = useState(empty);
  const [query, setQuery] = useState<MemberDataQuery>({ search: "", status: "ACTIVE", city: "", registrationSource: "ALL",
    periodMode: "MONTH", month: thisMonth, date: today, eventCodeId: "", page: 1, pageSize: 25 });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => { const timer = setTimeout(() => setQuery(current => ({ ...current, search: search.trim(), page: 1 })), 350); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    api.getWorkspace(query, controller.signal).then(data => { if (!controller.signal.aborted) setWorkspace(data); })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Gagal memuat Data Donatur."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, reload]);
  const updateQuery = useCallback((next: Partial<MemberDataQuery>) => setQuery(current => ({ ...current, ...next, page: next.page ?? 1 })), []);
  return { workspace, query, search, setSearch, loading, error, updateQuery, reload: () => setReload(value => value + 1) };
}
