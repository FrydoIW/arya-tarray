"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError } from "@/lib/api";
import { getWorkspaceCache, invalidateWorkspaceCache, readWorkspace, workspaceCacheKey } from "@/lib/workspace-cache";
import * as api from "../api/member-registration.api";
import type { MemberInput, Workspace, WorkspaceQuery } from "../types";
const empty: Workspace = { summary: { unverified: 0, verified: 0, ignored: 0 }, rows: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } };
const REGISTRATION_WORKSPACE_PREFIX = "member/registration/workspace";
function registrationKey(query: WorkspaceQuery) { return workspaceCacheKey(REGISTRATION_WORKSPACE_PREFIX, query); }
export function useMemberRegistration() {
  const initialQuery: WorkspaceQuery = { search: "", status: "UNVERIFIED", page: 1, pageSize: 25 };
  const initialWorkspace = getWorkspaceCache<Workspace>(registrationKey(initialQuery))?.value ?? empty;
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [query, setQuery] = useState<WorkspaceQuery>(initialQuery);
  const [search, setSearch] = useState("");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(initialWorkspace === empty);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(current => ({ ...current, search: search.trim(), page: 1 })), 350);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    const key = registrationKey(query);
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
    }).catch(caught => {
      if (!controller.signal.aborted && !isAbortError(caught)) setError(caught instanceof Error ? caught.message : "Gagal memuat registrasi.");
    }).finally(() => { read.release(); if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, reload]);
  const refresh = useCallback(() => { invalidateWorkspaceCache(REGISTRATION_WORKSPACE_PREFIX); setReload(value => value + 1); }, []);
  async function perform(action: () => Promise<unknown>, success: string) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      await action();
      invalidateWorkspaceCache("member/data/workspace");
      invalidateWorkspaceCache("monitoring/dashboard/workspace");
      invalidateWorkspaceCache("reconciliation/transaction-inquiry/workspace");
      setMessage(success); refresh(); return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Tindakan gagal."); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  return { workspace, query, search, setSearch, loading, busy, error, message, refresh,
    clearError: () => setError(""),
    changeStatus: (status: WorkspaceQuery["status"]) => setQuery(current => ({ ...current, status, page: 1 })),
    changePage: (page: number) => setQuery(current => ({ ...current, page })),
    changePageSize: (pageSize: number) => setQuery(current => ({ ...current, pageSize, page: 1 })),
    register: (input: MemberInput, identityId?: string) => perform(() => api.registerMember(input, identityId), "Donatur berhasil diregistrasi."),
    link: (identityId: string, memberId: string) => perform(() => api.linkMember(identityId, memberId), "Identitas berhasil dihubungkan."),
    ignore: (identityId: string, reason: string) => perform(() => api.ignoreIdentity(identityId, reason), "Identitas diabaikan.")
  };
}
