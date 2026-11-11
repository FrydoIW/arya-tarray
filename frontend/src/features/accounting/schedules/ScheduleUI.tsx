'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { CoreFeedback, CoreTable } from '../core/CoreUI';
import { useCoreMutation } from '../core/hooks';
import { accountingMoney } from '../core/presentation';
import { ApprovalLink } from '../apar/fields';
import styles from '../core/core.module.css';
import type { PlanRow, RetainedApproval } from './types';

export function ScheduleLinks() {
  return <nav className={styles.toolbar} aria-label="Accrual and schedule views">
    <Link className={styles.link} href="/accounting/accruals">Accruals</Link>
    <Link className={styles.link} href="/accounting/accruals/reversals">Scheduled reversals</Link>
    <Link className={styles.link} href="/accounting/schedules">Prepayments & deferred income</Link>
  </nav>;
}

export function PlanTable({ rows, label, periodLabels }: { rows: PlanRow[]; label: string; periodLabels: Map<string, string> }) {
  return <CoreTable label={label} headers={['Accounting period', 'Recognition date', 'Planned allocation']}>
    {rows.map(row => <tr key={row.accountingPeriodId}>
      <td>{periodLabels.get(row.accountingPeriodId) ?? row.accountingPeriodId}</td><td>{row.recognitionDate.slice(0, 10)}</td><td>{accountingMoney(row.plannedAmount)}</td>
    </tr>)}
  </CoreTable>;
}

export function SourceHistory({ approvals, limit }: { approvals: RetainedApproval[]; limit: number }) {
  return <>
    <h2>Approval and audit history</h2>
    <p className={styles.note}>The source returns up to {limit} approval records.</p>
    {approvals.length ? <CoreTable label="Source approval records" headers={['Request', 'Version', 'Decision state', 'Audit']}>
      {approvals.map(item => <tr key={item.id}>
        <td><ApprovalLink id={item.id}>{item.requestKind}</ApprovalLink></td><td>{item.sourceVersion}</td>
        <td><AccountingStatusIndicator status={item.status} /></td>
        <td className={styles.wrap}>{item.history?.map(event => <div key={event.id}>{event.actionAt} · {event.action} · {event.actorId}
          {event.remark ? ' · ' + event.remark : ''}</div>)}</td>
      </tr>)}
    </CoreTable> : <p className={styles.note}>No source approvals returned.</p>}
  </>;
}

export function ActionReview<T>({ title, description, fields, validate, run, onDone, onClose }: {
  title: string;
  description: string;
  fields?: ReactNode;
  validate: () => string;
  run: () => Promise<T>;
  onDone: (result: T) => void;
  onClose: () => void;
}) {
  const mutation = useCoreMutation();
  const [reviewing, setReviewing] = useState(false);
  const [issue, setIssue] = useState('');
  async function execute() {
    const error = validate();
    setIssue(error);
    if (error) { setReviewing(false); return; }
    const result = await mutation.run(run, 'Action confirmed.');
    if (result !== undefined) onDone(result);
  }
  return <Modal open title={title} description={description} onClose={() => { if (!mutation.busy) onClose(); }}>
    <form className={styles.modal} noValidate onSubmit={event => {
      event.preventDefault();
      const error = validate();
      setIssue(error);
      setReviewing(!error);
    }}>
      <CoreFeedback error={issue || mutation.error} message={mutation.message} />
      {fields ? <fieldset className={styles.page} disabled={reviewing || mutation.busy}>{fields}</fieldset> : null}
      {reviewing ? <div className={styles.actions}>
        <Button variant="outline" disabled={mutation.busy} onClick={() => setReviewing(false)}>Back to details</Button>
        <Button disabled={mutation.busy} onClick={execute}>Confirm action</Button>
      </div> : <Button type="submit">Review action</Button>}
    </form>
  </Modal>;
}
