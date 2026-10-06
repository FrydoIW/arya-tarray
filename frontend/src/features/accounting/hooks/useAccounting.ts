"use client";
import { useEffect, useState } from "react";
import { getAccountingOptions, getAccountingReport } from "../api/accounting.api";
import type { AccountingOptions, AccountingReport } from "../types";

export function useAccounting(query: string, memberSearch: string) {
  const [report, setReport] = useState<AccountingReport | null>(null);
  const [options, setOptions] = useState<AccountingOptions | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    getAccountingReport(query, controller.signal).then(value => { if (!controller.signal.aborted) setReport(value); })
      .catch(e => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "Accounting could not load"); setReport(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => getAccountingOptions(memberSearch, controller.signal).then(setOptions)
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Filters could not load"); }), 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [memberSearch]);
  return { report, options, error, loading };
}
