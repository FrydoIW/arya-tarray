"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api/member-registration.api";
import type { MemberInput, Workspace, WorkspaceQuery } from "../types";
const empty: Workspace = { summary: { unverified: 0, verified: 0, ignored: 0 }, rows: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } };
export function useMemberRegistration() {
  const [workspace, setWorkspace] = useState(empty);
  const [query, setQuery] = useState<WorkspaceQuery>({ search: "", status: "UNVERIFIED", page: 1, pageSize: 25 });
  const [search, setSearch] = useState("");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
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
    setLoading(true); setError("");
    api.getWorkspace(query, controller.signal).then(data => {
      if (!controller.signal.aborted) setWorkspace(data);
    }).catch(caught => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Gagal memuat registrasi.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, reload]);
  const refresh = useCallback(() => setReload(value => value + 1), []);
  async function perform(action: () => Promise<unknown>, success: string) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      await action(); setMessage(success); refresh(); return true;
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
    ignore: (identityId: string, remark: string | null) => perform(() => api.ignoreIdentity(identityId, remark), "Identitas diabaikan.")
  };
}
