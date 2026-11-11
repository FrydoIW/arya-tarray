"use client";
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import type { AccountingFiscalYear } from '../types';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { CoreCard, CoreFeedback, CoreField, CoreInput, CorePage, CorePolicyNote, CoreReadState, CoreTable } from './CoreUI';
import { useFiscalYears } from './FiscalScope';
import { createFiscalYear, createPeriod } from './api';
import { useCoreMutation } from './hooks';
import styles from './core.module.css';

function FiscalForm({ mode, years, onClose, onSaved }: { mode: 'year' | 'period'; years: AccountingFiscalYear[]; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [yearId, setYearId] = useState(''), [number, setNumber] = useState('');
  const [review, setReview] = useState(false), [validation, setValidation] = useState(''), mutation = useCoreMutation();
  function prepare() {
    const year = years.find(item => item.id === yearId);
    if (!code.trim() || !from || !to || from > to) { setValidation('Code and a valid date range are required.'); return; }
    if (mode === 'period' && (!year || year.status !== 'OPEN' || !/^\d+$/.test(number) || Number(number) < 1 || Number(number) > 53 || from < year.startDate.slice(0, 10) || to > year.endDate.slice(0, 10))) { setValidation('Select an OPEN fiscal year, period number 1–53 and dates within that year.'); return; }
    setValidation(''); setReview(true);
  }
  async function save() {
    const result = await mutation.run(() => mode === 'year' ? createFiscalYear({ yearCode: code.trim(), startDate: from, endDate: to }) : createPeriod({ fiscalYearId: yearId, periodNo: Number(number), periodCode: code.trim(), startDate: from, endDate: to }), 'Fiscal configuration created.');
    if (result !== undefined) onSaved();
  }
  return <Modal open title={mode === 'year' ? 'Create fiscal year' : 'Create accounting period'} description="Explicit configuration only. This does not change cutover or close/reopen an existing period." onClose={() => { if (!mutation.busy) onClose(); }}><form className={styles.modal} onSubmit={e => { e.preventDefault(); prepare(); }} onChange={() => setReview(false)}>
    <CoreFeedback error={validation || mutation.error} message={mutation.message} /><fieldset disabled={mutation.busy} className={styles.formGrid}>
      <CoreInput label={mode === 'year' ? 'Fiscal year code' : 'Period code'} required maxLength={20} value={code} onChange={e => setCode(e.target.value)} />
      {mode === 'period' ? <><CoreField label="Parent fiscal year"><Select aria-label="Parent fiscal year" required value={yearId} onChange={e => setYearId(e.target.value)}><option value="">Select OPEN fiscal year</option>{years.map(year => <option key={year.id} value={year.id} disabled={year.status !== 'OPEN'}>{year.yearCode} · {year.status}</option>)}</Select></CoreField><CoreInput label="Period number" required type="number" min={1} max={53} step={1} value={number} onChange={e => setNumber(e.target.value)} /></> : null}
      <CoreInput label="Start date" required type="date" value={from} onChange={e => setFrom(e.target.value)} /><CoreInput label="End date" required type="date" value={to} onChange={e => setTo(e.target.value)} />
    </fieldset>
    {review ? <><p className={styles.warning}>Create {mode === 'year' ? 'fiscal year' : 'accounting period'} {code}, {from}–{to}, with initial OPEN status? The backend checks overlaps and parent state. Existing CLOSED periods and cutover are unchanged.</p><div className={styles.actions}><Button disabled={mutation.busy} onClick={() => void save()}>{mutation.busy ? 'Saving…' : 'Confirm fiscal configuration'}</Button><Button variant="outline" disabled={mutation.busy} onClick={() => setReview(false)}>Back to form</Button></div></> : <Button type="submit" disabled={mutation.busy}>Review fiscal configuration</Button>}
  </form></Modal>;
}
export function PeriodWorkspace() {
  const user = useAuthSession(), read = useFiscalYears(), canManage = user.menuCodes.includes('ACCOUNTING_PERIOD_MANAGE');
  const [mode, setMode] = useState<'year' | 'period' | null>(null), [message, setMessage] = useState('');
  return <CorePage title="Fiscal Years & Periods" description="Fiscal configuration, lifecycle and entry point to controlled closing." actions={<><Button variant="outline" disabled={read.loading} onClick={read.refresh}>Refresh</Button>{canManage ? <><Button variant="outline" onClick={() => setMode('year')}>Create fiscal year</Button><Button disabled={!read.data?.some(year => year.status === 'OPEN')} onClick={() => setMode('period')}>Create period</Button></> : null}</>}>
    <CorePolicyNote /><CoreFeedback error="" message={message} /><CoreCard><p className={styles.note}>Cutover is enforced by backend configuration. Closing and reopening use the separate Stage 3.7 workspace, backend checklist, independent approval and authorized application; status is never changed locally.</p><div className={styles.actions}><Link href="/accounting/closing" className={styles.link}>Open Reconciliation & Closing</Link><Link href="/accounting/reports" className={styles.link}>View existing reports and cutover information</Link></div><CoreReadState read={read} empty={read.data?.length === 0} />
      {read.data && !read.loading && !read.error ? read.data.map(year => <section key={year.id} className={styles.page}><div className={styles.actions}><h2>{year.yearCode}</h2><AccountingStatusIndicator status={year.status} /><span>{year.startDate.slice(0, 10)}–{year.endDate.slice(0, 10)}</span></div>{year.status !== 'OPEN' ? <p className={styles.warning}>This fiscal year is not OPEN. Posting is not available; use the authorized closing/reopening workflow when implemented.</p> : null}
        {!year.revFkAccPeriodFy.length ? <p className={styles.note}>No periods configured. An authorized period manager must configure them explicitly before posting.</p> : <CoreTable label={`Periods for ${year.yearCode}`} headers={['Period', 'Number', 'From', 'To', 'Status', 'Closed at', 'Posting availability']}>
          {year.revFkAccPeriodFy.map(period => <tr key={period.id}><td>{period.periodCode}</td><td>{period.periodNo}</td><td>{period.startDate.slice(0, 10)}</td><td>{period.endDate.slice(0, 10)}</td><td><AccountingStatusIndicator status={period.status} /></td><td>{period.closedAt ?? 'Not closed'}</td><td>{year.status === 'OPEN' && period.status === 'OPEN' ? 'Subject to backend validation' : 'Blocked — period/year not OPEN'}</td></tr>)}
        </CoreTable>}
      </section>) : null}
    </CoreCard>{mode && canManage ? <FiscalForm mode={mode} years={read.data ?? []} onClose={() => setMode(null)} onSaved={() => { setMode(null); setMessage('Fiscal configuration created. Existing cutover and periods retained.'); read.refresh(); }} /> : null}
  </CorePage>;
}
