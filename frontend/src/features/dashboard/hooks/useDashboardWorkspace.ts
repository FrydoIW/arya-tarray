"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError } from "@/lib/api";
import { getDashboardSummary } from "../api/dashboard.api";
import type { DashboardPeriodMode, DashboardSummary } from "../types";
import { currentDayValue, currentMonthValue } from "../utils/dashboard.utils";

const AUTO_REFRESH_MS = 5 * 60 * 1000;

export function useDashboardWorkspace() {
  const [month, setMonth] = useState(currentMonthValue);
  const [date, setDate] = useState(currentDayValue);
  const [periodMode, setPeriodMode] = useState<DashboardPeriodMode>("MONTH");
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (silent = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (!silent) {
      setLoading(true);
      setData(null);
    }
    setError("");
    try {
      const next = await getDashboardSummary({ mode: periodMode, month, date }, controller.signal);
      if (!controller.signal.aborted) setData(next);
    } catch (err) {
      if (!isAbortError(err)) setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [date, month, periodMode]);

  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(true), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  function changePeriod(value: { mode: DashboardPeriodMode; month: string; date: string }) {
    setPeriodMode(value.mode);
    setMonth(value.month);
    setDate(value.date);
  }

  return { period: { mode: periodMode, month, date }, changePeriod, data, loading, error, reload: load };
}
