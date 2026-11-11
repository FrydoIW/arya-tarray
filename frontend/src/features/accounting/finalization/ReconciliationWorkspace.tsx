"use client";
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { CoreCard, CoreField, CorePage, CorePolicyNote, CoreReadState } from '../core/CoreUI';
import { useFiscalYears } from '../core/FiscalScope';
import { useCoreRead } from '../core/hooks';
import { accountingMoney } from '../core/presentation';
import type { AccountingFiscalYear } from '../types';
import type { ControlReconciliation, FundReconciliation, ReconciliationException, SubledgerBundle } from './types';
import styles from './finalization.module.css';

function evidence(value: unknown) {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
function ExceptionList({ rows }: { rows: ReconciliationException[] }) {
  if (!rows.length) return <p className={styles.note}>No backend exception was returned for this scope.</p>;
  return <ul className={styles.exceptionList}>{rows.map((row, index) => <li className={styles.exception} key={`${row.code}-${row.sourceId ?? index}`}>
    <strong>{row.code}</strong>{row.severity ? ` · ${row.severity}` : ''}<br />{row.reason ?? 'Backend exception'}{row.amount ? ` · ${accountingMoney(row.amount)}` : ''}{row.sourceId ? <><br />Source: {row.sourceId}</> : null}
  </li>)}</ul>;
}
function ControlModule({ title, value, href }: { title: string; value: ControlReconciliation; href: string }) {
  return <section className={styles.module}><div className={styles.actions}><h2>{title}</h2><AccountingStatusIndicator status={value.status} /></div>
    <div className={styles.summary}><div className={styles.metric}><span>Subledger</span><strong>{accountingMoney(value.subledgerTotal)}</strong></div><div className={styles.metric}><span>General ledger</span><strong>{accountingMoney(value.glTotal)}</strong></div><div className={styles.metric}><span>Difference</span><strong className={value.difference && value.difference !== '0.00' ? styles.danger : ''}>{accountingMoney(value.difference)}</strong></div><div className={styles.metric}><span>As of</span><strong>{value.asOf}</strong></div></div>
    {value.components ? <dl className={styles.details}><dt>Acquisition / cost</dt><dd>{accountingMoney(value.components.cost)}</dd><dt>Accumulated depreciation</dt><dd>{accountingMoney(value.components.accumulatedDepreciation)}</dd><dt>Impairment</dt><dd>{accountingMoney(value.components.impairment)}</dd><dt>Carrying value</dt><dd>{accountingMoney(value.components.netCarryingValue)}</dd><dt>Depreciation expense</dt><dd>{accountingMoney(value.components.depreciationExpenseBeforeAnnualClosing)}</dd></dl> : null}
    {value.rows?.length ? <div className={styles.scroll} tabIndex={0} role="region" aria-label={`${title} control accounts`}><table className={styles.table}><thead><tr><th>Control account</th><th>Subledger</th><th>GL</th><th>Difference</th></tr></thead><tbody>{value.rows.map(row => <tr key={row.accountId}><td>{row.accountId}</td><td>{accountingMoney(row.subledger)}</td><td>{accountingMoney(row.generalLedger)}</td><td>{accountingMoney(row.difference)}</td></tr>)}</tbody></table></div> : null}
    <ExceptionList rows={value.exceptions} /><p className={styles.note}>{value.evidence ?? 'Backend values are authoritative. No frontend balancing calculation is performed.'}</p><Link href={href}>Open source workspace</Link>
  </section>;
}
function FundModule({ value }: { value: FundReconciliation }) {
  return <section className={styles.module}><div className={styles.actions}><h2>Fund accounting</h2><AccountingStatusIndicator status={value.status} /></div>
    <p className={styles.warning}>Fund balances, donor restrictions, internal designations, campaign wallets and available bank cash are separate concepts. This view only presents the backend Stage 2.6 as-of comparison.</p>
    {value.controls.length ? <div className={styles.scroll} tabIndex={0} role="region" aria-label="Fund reconciliation controls"><table className={styles.table}><thead><tr><th>Fund</th><th>Classified</th><th>Released</th><th>Remaining</th><th>GL resources</th><th>Difference</th></tr></thead><tbody>{value.controls.map(row => <tr key={row.fundId}><td>{row.fundId}</td><td>{accountingMoney(row.classified)}</td><td>{accountingMoney(row.released)}</td><td>{accountingMoney(row.remaining)}</td><td>{accountingMoney(row.glNetResources)}</td><td>{accountingMoney(row.difference)}</td></tr>)}</tbody></table></div> : <p className={styles.note}>No fund control rows were returned for this cutoff.</p>}
    <ExceptionList rows={value.exceptions} /><p className={styles.note}>{value.financialSource}</p><Link href="/accounting/funds/reconciliation">Open current per-fund reconciliation</Link>
  </section>;
}

function defaultScope(years: AccountingFiscalYear[]) {
  const year = years[0];
  const period = year?.revFkAccPeriodFy.at(-1);
  return { yearId: year?.id ?? '', asOf: (period?.endDate ?? year?.endDate ?? '').slice(0, 10) };
}
export function ReconciliationWorkspace() {
  const fiscal = useFiscalYears();
  const [yearId, setYearId] = useState(''), [asOf, setAsOf] = useState('');
  useEffect(() => { if (!yearId && fiscal.data?.length) { const next = defaultScope(fiscal.data); setYearId(next.yearId); setAsOf(next.asOf); } }, [fiscal.data, yearId]);
  const path = yearId && asOf ? `subledger-reconciliation?${new URLSearchParams({ fiscalYearId: yearId, asOf })}` : 'subledger-reconciliation';
  const read = useCoreRead<SubledgerBundle>(path, Boolean(yearId && /^\d{4}-\d{2}-\d{2}$/.test(asOf)));
  const selected = useMemo(() => fiscal.data?.find(year => year.id === yearId), [fiscal.data, yearId]);
  return <CorePage title="Reconciliation" description="Bank-to-GL and source-backed subledger controls. Backend evidence remains the source of truth." actions={<Button variant="outline" disabled={read.loading || !yearId} onClick={read.refresh}>Refresh reconciliation</Button>}>
    <CorePolicyNote /><CoreCard><div className={styles.toolbar}><CoreField label="Fiscal year"><Select aria-label="Fiscal year" value={yearId} onChange={event => { const id = event.target.value; const year = fiscal.data?.find(item => item.id === id); setYearId(id); setAsOf((year?.endDate ?? '').slice(0, 10)); }}><option value="">Select fiscal year</option>{fiscal.data?.map(year => <option value={year.id} key={year.id}>{year.yearCode} · {year.status}</option>)}</Select></CoreField><label><span className={styles.note}>As-of date</span><input className="ui-table-input" aria-label="As-of date" type="date" min={selected?.startDate.slice(0, 10)} max={selected?.endDate.slice(0, 10)} value={asOf} onChange={event => setAsOf(event.target.value)} /></label><Link href="/accounting/reconciliation/bank">Open Bank-to-GL workspace</Link><Link href="/accounting/closing">Open period closing</Link></div>
      <p className={styles.note}>The API accepts a fiscal year and exact as-of date. AP/AR cutoff, asset evidence, accrual/schedule evidence and fund classifications are evaluated by Stage 2.6; page totals are never recomputed here.</p><CoreReadState read={fiscal} /><CoreReadState read={read} />
    </CoreCard>
    {read.data && !read.loading && !read.error ? <><div className={styles.actions}><AccountingStatusIndicator status={read.data.status} /><span className={styles.note}>Combined backend status as of {read.data.asOf}</span></div><div className={styles.moduleGrid}>
      <ControlModule title="Accounts Payable" value={read.data.ap} href="/accounting/payables" /><ControlModule title="Accounts Receivable" value={read.data.ar} href="/accounting/receivables" />
      <ControlModule title="Fixed Assets" value={read.data.assets} href="/accounting/assets/reconciliation" /><ControlModule title="Accruals & prepayments" value={read.data.accruals} href="/accounting/accruals" /><FundModule value={read.data.funds} />
      <section className={styles.module}><h2>Bank-to-GL</h2><p className={styles.note}>Bank matching has its own period-scoped workflow, evidence, timing items and independent sign-off. Operational RAW → CHECK → FINALIZED remains unchanged.</p><Link href="/accounting/reconciliation/bank">Review bank reconciliations</Link><Link href="/reconciliation/transaction-inquiry">Open operational bank evidence</Link></section>
    </div></> : null}
  </CorePage>;
}
