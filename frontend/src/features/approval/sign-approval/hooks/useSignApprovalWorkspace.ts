"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSignApprovalWorkspace } from "../api/sign-approval.api";
import type { SignApprovalStatusFilter, SignApprovalWorkspace } from "../types";
import { filterApprovalQueue } from "../utils/sign-approval.utils";

const EMPTY_WORKSPACE: SignApprovalWorkspace = {
  eligible: false,
  summary: {
    pendingApproval: 0,
    approvedToday: 0,
    rejectedToday: 0,
    totalDecided: 0
  },
  approvals: []
};

export function useSignApprovalWorkspace() {
  const [workspace, setWorkspace] = useState<SignApprovalWorkspace>(EMPTY_WORKSPACE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SignApprovalStatusFilter>("PENDING");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setWorkspace(await getSignApprovalWorkspace());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load approval queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredApprovals = useMemo(
    () => filterApprovalQueue(workspace.approvals, search, statusFilter),
    [search, statusFilter, workspace.approvals]
  );

  return {
    workspace,
    filteredApprovals,
    loading,
    error,
    search,
    statusFilter,
    setSearch,
    setStatusFilter,
    refresh
  };
}
