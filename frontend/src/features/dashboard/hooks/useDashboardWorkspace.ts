"use client";

import { useCallback, useEffect, useState } from "react";
import { getDashboardSummary } from "../api/dashboard.api";
import type { DashboardSummary } from "../types";
import { currentMonthValue } from "../utils/dashboard.utils";

const AUTO_REFRESH_MS = 5 * 60 * 1000;

export function useDashboardWorkspace() {
  const [month, setMonth] = useState(currentMonthValue);
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
      setData(await getDashboardSummary(month));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(true), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return { month, setMonth, data, loading, error, reload: load };
}
