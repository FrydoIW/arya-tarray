"use client";
import { useEffect, useState } from "react";
import * as api from "../api/member-data.api";
import type { IdentityHistoryWorkspace } from "../types";

const empty: IdentityHistoryWorkspace = { rows: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } };

export function useMemberIdentityHistory(memberId: string) {
  const [workspace, setWorkspace] = useState(empty);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    api.getIdentityHistory(memberId, page, pageSize, controller.signal)
      .then(data => {
        if (!controller.signal.aborted) {
          setWorkspace(data);
          setPage(current => current === data.pagination.page ? current : data.pagination.page);
        }
      })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Gagal memuat riwayat kepemilikan identitas."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [memberId, page, pageSize, reload]);
  return {
    workspace, loading, error,
    changePage: (next: number) => setPage(next),
    changePageSize: (next: number) => { setPageSize(next); setPage(1); },
    reload: () => setReload(value => value + 1)
  };
}
