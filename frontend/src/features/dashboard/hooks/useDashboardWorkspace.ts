"use client";

import { useCallback, useEffect, useState } from "react";
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

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setData(null);
    }
    setError("");
    try {
      setData(await getDashboardSummary({ mode: periodMode, month, date }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [date, month, periodMode]);

  useEffect(() => {
    void load();
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
