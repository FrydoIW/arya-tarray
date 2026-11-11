"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, isAbortError } from "@/lib/api";
import { invalidateWorkspaceCache, readWorkspace } from "@/lib/workspace-cache";

export function useAccountingRead<T>(key: string, loader: (signal: AbortSignal) => Promise<T>, enabled = true, force = false) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string; forbidden: boolean }>({ data: null, loading: enabled, error: "", forbidden: false });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) { setState({ data: null, loading: false, error: "", forbidden: false }); return; }
    let active = true;
    const read = readWorkspace(key, loader, { force });
    setState({ data: read.cached ?? null, loading: !!read.promise, error: "", forbidden: false });
    read.promise?.then(data => { if (active) setState({ data, loading: false, error: "", forbidden: false }); })
      .catch(error => { if (active && !isAbortError(error)) setState({ data: null, loading: false, error: error instanceof Error ? error.message : "Accounting data could not load.", forbidden: error instanceof ApiError && error.status === 403 }); });
    // Existing cache owns the network AbortController and coalesces concurrent subscribers.
    return () => { active = false; read.release(); };
  }, [key, loader, enabled, revision, force]);
  const refresh = useCallback(() => { invalidateWorkspaceCache(key); setRevision(current => current + 1); }, [key]);
  return { ...state, refresh };
}
