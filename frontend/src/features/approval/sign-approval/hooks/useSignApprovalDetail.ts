"use client";

import { useCallback, useEffect, useState } from "react";
import {
  approveSignApproval,
  getSignApprovalDetail,
  rejectSignApproval
} from "../api/sign-approval.api";
import type { SignApprovalDetail } from "../types";

export function useSignApprovalDetail(approvalId: string | null) {
  const [detail, setDetail] = useState<SignApprovalDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!approvalId) {
      setDetail(null);
      return;
    }

    setLoading(true);
    setError("");
    try {
      setDetail(await getSignApprovalDetail(approvalId));
    } catch (cause) {
      setDetail(null);
      setError(cause instanceof Error ? cause.message : "Failed to load approval detail");
    } finally {
      setLoading(false);
    }
  }, [approvalId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const approve = useCallback(async (remark?: string) => {
    if (!approvalId) return false;
    setDeciding(true);
    setError("");
    try {
      await approveSignApproval(approvalId, remark);
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to approve request";
      setError(message);
      try {
        setDetail(await getSignApprovalDetail(approvalId));
      } catch {
        // Preserve the original decision error; the queue can still be reloaded from Back to Queue.
      }
      return false;
    } finally {
      setDeciding(false);
    }
  }, [approvalId, refresh]);

  const reject = useCallback(async (remark: string) => {
    if (!approvalId) return false;
    setDeciding(true);
    setError("");
    try {
      await rejectSignApproval(approvalId, remark);
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to reject request";
      setError(message);
      try {
        setDetail(await getSignApprovalDetail(approvalId));
      } catch {
        // Preserve the original decision error; the queue can still be reloaded from Back to Queue.
      }
      return false;
    } finally {
      setDeciding(false);
    }
  }, [approvalId, refresh]);

  return {
    detail,
    loading,
    deciding,
    error,
    refresh,
    approve,
    reject
  };
}
