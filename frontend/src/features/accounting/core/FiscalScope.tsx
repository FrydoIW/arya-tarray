"use client";
import { Select } from '@/components/ui/Select';
import type { AccountingFiscalYear } from '../types';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { CoreField, CoreReadState } from './CoreUI';
import { useCoreRead } from './hooks';
import styles from './core.module.css';

export type FiscalSelection = { yearId: string; periodId: string; from: string; to: string };
export function useFiscalYears() { return useCoreRead<AccountingFiscalYear[]>('periods/fiscal-years'); }
export function FiscalScope({ value, onChange, read }: { value: FiscalSelection; onChange: (value: FiscalSelection) => void; read: ReturnType<typeof useFiscalYears> }) {
  const year = read.data?.find(item => item.id === value.yearId), period = year?.revFkAccPeriodFy.find(item => item.id === value.periodId);
  return <><CoreField label="Fiscal year"><Select aria-label="Fiscal year" value={value.yearId} disabled={read.loading} onChange={e => {
    const next = read.data?.find(item => item.id === e.target.value);
    onChange({ ...value, yearId: e.target.value, periodId: '', ...(next ? { from: next.startDate.slice(0, 10), to: next.endDate.slice(0, 10) } : {}) });
  }}><option value="">Custom date scope</option>{read.data?.map(item => <option key={item.id} value={item.id}>{item.yearCode} · {item.status}</option>)}</Select></CoreField>
    <CoreField label="Accounting period"><Select aria-label="Accounting period" value={value.periodId} disabled={!year || read.loading} onChange={e => {
      const next = year?.revFkAccPeriodFy.find(item => item.id === e.target.value);
      onChange({ ...value, periodId: e.target.value, ...(next ? { from: next.startDate.slice(0, 10), to: next.endDate.slice(0, 10) } : year ? { from: year.startDate.slice(0, 10), to: year.endDate.slice(0, 10) } : {}) });
    }}><option value="">All dates in selected year</option>{year?.revFkAccPeriodFy.map(item => <option key={item.id} value={item.id}>{item.periodCode} · {item.status}</option>)}</Select></CoreField>
    <CoreReadState read={read} />{period || year ? <div className={styles.actions}><AccountingStatusIndicator status={period?.status ?? year?.status ?? ''} />{(period?.status ?? year?.status) !== 'OPEN' ? <span>Historical reporting remains available. This scope is not open for posting.</span> : <span>OPEN is a lifecycle status, not financial readiness.</span>}</div> : null}</>;
}
export function openDateReason(years: AccountingFiscalYear[] | null, day: string) {
  if (!years) return 'Fiscal configuration must be loaded before submission.';
  const year = years.find(item => item.startDate.slice(0, 10) <= day && day <= item.endDate.slice(0, 10));
  const period = year?.revFkAccPeriodFy.find(item => item.startDate.slice(0, 10) <= day && day <= item.endDate.slice(0, 10));
  if (!year || !period) return 'No configured accounting period contains this date.';
  return year.status === 'OPEN' && period.status === 'OPEN' ? '' : 'The fiscal year or accounting period is not OPEN. Posting is blocked.';
}
