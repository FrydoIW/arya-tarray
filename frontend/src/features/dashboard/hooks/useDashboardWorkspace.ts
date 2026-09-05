"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError } from "@/lib/api";
import { getWorkspaceCache, readWorkspace, workspaceCacheKey } from "@/lib/workspace-cache";
import { getDashboardSummary } from "../api/dashboard.api";
import type { DashboardPeriodMode, DashboardSummary } from "../types";
import { currentDayValue, currentMonthValue } from "../utils/dashboard.utils";

const AUTO_REFRESH_MS = 5 * 60 * 1000;

export function useDashboardWorkspace() {
  const [month, setMonth] = useState(currentMonthValue);
  const [date, setDate] = useState(currentDayValue);
  const [periodMode, setPeriodMode] = useState<DashboardPeriodMode>("MONTH");
  const initialKey = workspaceCacheKey("monitoring/dashboard/workspace", { periodMode: "MONTH", month: currentMonthValue(), date: currentDayValue() });
  const initialData = getWorkspaceCache<DashboardSummary>(initialKey)?.value ?? null;
  const [data, setData] = useState<DashboardSummary | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (silent = false, force = false, consumerSignal?: AbortSignal) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    consumerSignal?.addEventListener("abort", () => controller.abort(), { once: true });
    const key = workspaceCacheKey("monitoring/dashboard/workspace", { periodMode, month, date });
    const read = readWorkspace(key, (signal) => getDashboardSummary({ mode: periodMode, month, date }, signal), { force });
    controller.signal.addEventListener("abort", read.release, { once: true });
    if (read.cached) setData(read.cached);
    if (!read.promise) {
      if (requestRef.current === controller) requestRef.current = null;
      setLoading(false);
      return true;
    }
    if (!silent && !read.cached) {
      setLoading(true);
      setData(null);
    }
    setError("");
    try {
      const next = await read.promise;
      if (!controller.signal.aborted) {
        setData(next);
      }
      return true;
    } catch (err) {
      if (!isAbortError(err) && !controller.signal.aborted) setError(err instanceof Error ? err.message : "Failed to load dashboard");
      return false;
    } finally {
      controller.signal.removeEventListener("abort", read.release);
      read.release();
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [date, month, periodMode]);

  useEffect(() => {
    void load(false, false);
    return () => requestRef.current?.abort();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(true, true), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  function changePeriod(value: { mode: DashboardPeriodMode; month: string; date: string }) {
    setPeriodMode(value.mode);
    setMonth(value.month);
    setDate(value.date);
  }

  return { period: { mode: periodMode, month, date }, changePeriod, data, loading, error, reload: () => load(false, true) };
}
