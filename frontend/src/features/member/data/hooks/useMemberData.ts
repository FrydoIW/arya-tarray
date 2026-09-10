"use client";
import { useCallback, useEffect, useState } from "react";
import { isAbortError } from "@/lib/api";
import { getWorkspaceCache, invalidateWorkspaceCache, readWorkspace, workspaceCacheKey } from "@/lib/workspace-cache";
import * as api from "../api/member-data.api";
import type { MemberDataQuery, MemberWorkspace } from "../types";
const empty: MemberWorkspace = { summary: { total: 0, active: 0, inactive: 0, manual: 0, statement: 0 },
  filters: { cities: [] }, rows: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } };
const MEMBER_DATA_WORKSPACE_PREFIX = "member/data/workspace";
function memberDataKey(query: MemberDataQuery) { return workspaceCacheKey(MEMBER_DATA_WORKSPACE_PREFIX, query); }
export function useMemberData() {
  const initialQuery: MemberDataQuery = { search: "", status: "ACTIVE", city: "", registrationSource: "ALL",
    page: 1, pageSize: 25 };
  const initialWorkspace = getWorkspaceCache<MemberWorkspace>(memberDataKey(initialQuery))?.value ?? empty;
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [query, setQuery] = useState<MemberDataQuery>(initialQuery);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(initialWorkspace === empty);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => { const timer = setTimeout(() => setQuery(current => ({ ...current, search: search.trim(), page: 1 })), 350); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    const key = memberDataKey(query);
    const read = readWorkspace(key, signal => api.getWorkspace(query, signal));
    if (read.cached) {
      setWorkspace(read.cached);
      setQuery(current => current.page === read.cached!.pagination.page ? current : { ...current, page: read.cached!.pagination.page });
    }
    setLoading(!read.cached); setError("");
    controller.signal.addEventListener("abort", read.release, { once: true });
    (read.promise ?? Promise.resolve(read.cached!)).then(data => {
      if (!controller.signal.aborted) {
        setWorkspace(data);
        setQuery(current => current.page === data.pagination.page ? current : { ...current, page: data.pagination.page });
      }
    })
      .catch(caught => { if (!controller.signal.aborted && !isAbortError(caught)) setError(caught instanceof Error ? caught.message : "Gagal memuat Data Donatur."); })
      .finally(() => { read.release(); if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, reload]);
  const updateQuery = useCallback((next: Partial<MemberDataQuery>) => setQuery(current => ({ ...current, ...next, page: next.page ?? 1 })), []);
  const updateLifecycle = useCallback(async (memberId: string, activeFlag: boolean) => {
    await api.updateLifecycle(memberId, activeFlag);
    invalidateWorkspaceCache(MEMBER_DATA_WORKSPACE_PREFIX);
    setReload(value => value + 1);
  }, []);
  return { workspace, query, search, setSearch, loading, error, updateQuery,
    reload: () => { invalidateWorkspaceCache(MEMBER_DATA_WORKSPACE_PREFIX); setReload(value => value + 1); }, updateLifecycle };
}
