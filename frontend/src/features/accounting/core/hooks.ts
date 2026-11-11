"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import { ApiError } from '@/lib/api';
import { getWorkspaceCache, invalidateWorkspaceCache, setWorkspaceCache } from '@/lib/workspace-cache';
import { useAccountingRead } from '../hooks/useAccountingRead';
import { coreRead } from './api';

export function useCoreRead<T>(path: string, enabled = true) {
  const user = useAuthSession();
  const load = useCallback((signal: AbortSignal) => coreRead<T>(path, signal), [path]);
  return useAccountingRead(`accounting:${user.id}:core:${path}`, load, enabled && user.menuCodes.includes('ACCOUNTING_REPORT'), true);
}
export function useCoreSelection<T>(name: string, initial: T, preferInitial = false) {
  const user = useAuthSession(), key = `accounting:${user.id}:selection:${name}`;
  const [value, setValue] = useState<T>(() => preferInitial ? initial : getWorkspaceCache<T>(key)?.value ?? initial);
  useEffect(() => { setWorkspaceCache(key, value); }, [key, value]);
  const update = useCallback((next: T) => { setWorkspaceCache(key, next); setValue(next); }, [key]);
  return [value, update] as const;
}
export function useCoreMutation() {
  const user = useAuthSession(), locked = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  async function run<T>(work: () => Promise<T>, success: string): Promise<T | undefined> {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const value = await work();
      // Refresh mounted core reads explicitly; re-entered core pages always read
      // current data. Do not abort unrelated in-flight fiscal/lookup subscribers.
      for (const suffix of ['coa-summary', 'fiscal-years', 'pending-approvals', 'legacy-report-accounts']) invalidateWorkspaceCache(`accounting:${user.id}:${suffix}`);
      setMessage(success); return value;
    } catch (problem) {
      const text = problem instanceof Error ? problem.message : 'Accounting request failed.';
      setError(problem instanceof ApiError && problem.status === 409 ? `${text} Refresh the current source/version before retrying.` : text);
    } finally { locked.current = false; setBusy(false); }
  }
  return { busy, error, message, run, clear: () => { setError(''); setMessage(''); } };
}
