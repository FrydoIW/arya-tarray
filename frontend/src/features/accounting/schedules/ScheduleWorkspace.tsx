'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import { ApprovalLink, JournalLink, positiveAmount, TextArea, validDay } from '../apar/fields';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { journalPermissions } from '../core/contracts.generated';
import { CoreCard, CoreFeedback, CoreInput, CorePage, CorePolicyNote, CoreReadState, CoreTable } from '../core/CoreUI';
import { openDateReason, useFiscalYears } from '../core/FiscalScope';
import { useCoreRead } from '../core/hooks';
import { accountingMoney } from '../core/presentation';
import styles from '../core/core.module.css';
import { requestCommand, requestPeriod } from './api';
import { documentLink } from './ClearingForm';
import { PlanEditor, validatePlan } from './PlanEditor';
import { ScheduleForm, scheduleKinds } from './ScheduleForm';
import { ActionReview, ScheduleLinks, SourceHistory } from './ScheduleUI';
import { SourceList } from './SourceList';
import type { PlanRow, Schedule, ScheduleCommand, SchedulePeriod, ScheduleRow } from './types';

type Action = { kind: ScheduleCommand['action'] } | { kind: 'PERIOD'; row: SchedulePeriod };
const actionLabels: Record<Action['kind'], string> = {
  SETUP: 'Request schedule setup', CHANGE: 'Revise unposted allocations', CANCEL: 'Request schedule cancellation',
  TERMINATE: 'Request early termination', PERIOD: 'Request period recognition',
};

function ScheduleAction({ action, schedule, onClose, onDone }: {
  action: Action; schedule: Schedule; onClose: () => void; onDone: (id: string) => void;
}) {
  const fiscal = useFiscalYears();
  const periods = fiscal.data?.flatMap(year => year.revFkAccPeriodFy) ?? [];
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [rows, setRows] = useState<PlanRow[]>(() => schedule.revFkAccSchedulePeriodParent.filter(row => !row.recognitionJournalId)
    .map(({ accountingPeriodId, recognitionDate, plannedAmount }) => ({ accountingPeriodId, recognitionDate: recognitionDate.slice(0, 10), plannedAmount })));
  const needsEvidence = action.kind === 'PERIOD' && schedule.scheduleKind === 'DEFERRED_INCOME';
  const decisionDate = action.kind === 'TERMINATE' ? date : action.kind === 'PERIOD' ? action.row.recognitionDate.slice(0, 10) : schedule.startDate.slice(0, 10);
  function validate() {
    if (!validDay(decisionDate)) return 'Enter a valid accounting date.';
    if (['CHANGE', 'TERMINATE', 'CANCEL'].includes(action.kind) && reason.trim().length < 10) return 'Enter an audit reason of at least 10 characters.';
    if (needsEvidence && reason.trim().length < 10) return 'Provide evidence that the performance obligation was fulfilled for this period.';
    const periodReason = openDateReason(fiscal.data, decisionDate);
    if (periodReason) return periodReason;
    if (action.kind === 'CHANGE') return validatePlan(rows, schedule.remaining, schedule.startDate.slice(0, 10), schedule.endDate.slice(0, 10), periods);
    return '';
  }
  function run() {
    switch (action.kind) {
      case 'PERIOD': return requestPeriod(action.row.id, schedule.revision, needsEvidence ? reason.trim() : undefined);
      case 'SETUP': return requestCommand(schedule.id, schedule.revision, { action: 'SETUP' });
      case 'CHANGE': return requestCommand(schedule.id, schedule.revision, { action: 'CHANGE', periods: rows, reason: reason.trim() });
      case 'CANCEL': return requestCommand(schedule.id, schedule.revision, { action: 'CANCEL', reason: reason.trim() });
      case 'TERMINATE': return requestCommand(schedule.id, schedule.revision, { action: 'TERMINATE', accountingDate: date, reason: reason.trim() });
    }
  }
  return <ActionReview title={actionLabels[action.kind]} description="Review the evidence and create an independent approval request. No posting occurs at submission."
    validate={validate} run={run} onDone={result => onDone(result.id)} onClose={onClose}
    fields={<><CoreReadState read={fiscal} />
      <CoreInput label="Action accounting date" type="date" value={decisionDate} readOnly={action.kind !== 'TERMINATE'} onChange={event => setDate(event.target.value)} />
      {action.kind === 'CHANGE' ? <>
        <p>Retain the existing unposted periods. Revised allocations must equal backend remaining balance {accountingMoney(schedule.remaining)}.</p>
        <PlanEditor rows={rows} periods={periods} fixedPeriods onChange={setRows} />
      </> : null}
      {action.kind === 'PERIOD' ? <p>Planned allocation · {accountingMoney(action.row.plannedAmount)}</p> : null}
      {needsEvidence || (action.kind !== 'SETUP' && action.kind !== 'PERIOD') ? <TextArea label={needsEvidence ? 'Period fulfillment evidence' : 'Audit reason'}
        value={reason} onChange={setReason} maxLength={1000} minLength={10} /> : null}
    </>} />;
}

function ScheduleDetail({ id }: { id: string }) {
  const user = useAuthSession();
  const read = useCoreRead<Schedule>('schedules/' + id), fiscal = useFiscalYears();
  const [action, setAction] = useState<Action | null>(null);
  const [approvalId, setApprovalId] = useState('');
  const schedule = read.data;
  const rows = schedule?.revFkAccSchedulePeriodParent ?? [];
  const periods = fiscal.data?.flatMap(year => year.revFkAccPeriodFy) ?? [];
  const first = rows.find(row => !row.recognitionJournalId);
  const owner = user.menuCodes.includes(journalPermissions.manage) && user.id === schedule?.createdById;
  const current = (source: string, kind: string) => schedule?.approvalHistory.find(item =>
    item.sourceDocumentId === source && item.requestKind === kind && item.sourceVersion === schedule.revision && ['APPROVED', 'PENDING'].includes(item.status));
  const sourceKind = schedule?.relFkAccScheduleSource.journal.sourceKind;
  const sourceSide = sourceKind === 'AP_DOCUMENT' ? 'ap' : sourceKind === 'AR_DOCUMENT' ? 'ar' : null;
  function commandButton(kind: ScheduleCommand['action']) {
    const request = current(id, 'SCHEDULE_' + kind);
    return request ? <ApprovalLink id={request.id}>{actionLabels[kind]} · {request.status}</ApprovalLink>
      : <Button variant="outline" onClick={() => setAction({ kind })}>{actionLabels[kind]}</Button>;
  }
  return <CorePage title="Schedule detail" description="Source evidence, independent review, period allocations, and posted recognition.">
    <ScheduleLinks /><CoreCard><CoreReadState read={read} /><CoreFeedback error="" message={approvalId ? 'Approval request created.' : ''} />
      {approvalId ? <ApprovalLink id={approvalId} /> : null}
      {schedule && !read.loading && !read.error ? <>
        <div className={styles.actions}><h2>{schedule.scheduleReference}</h2><AccountingStatusIndicator status={schedule.status} />
          <AccountingStatusIndicator status={schedule.policyStatus} /><Button variant="outline" onClick={read.refresh}>Refresh schedule</Button></div>
        {schedule.policyStatus === 'PENDING_INDEPENDENT_REVIEW' ? <p className={styles.warning}>Setup requires independent review. No period is posted automatically.</p> : null}
        <dl className={styles.details}>
          <dt>Kind / allocation method</dt><dd>{scheduleKinds.find(kind => kind.id === schedule.scheduleKind)?.label} · {schedule.allocationMethod}</dd>
          <dt>Service period</dt><dd>{schedule.startDate.slice(0, 10)} – {schedule.endDate.slice(0, 10)}</dd>
          <dt>Original scheduled amount</dt><dd>{accountingMoney(schedule.plannedAmount)}</dd>
          <dt>Recognized</dt><dd>{accountingMoney(schedule.recognized)}</dd>
          <dt>Terminated</dt><dd>{accountingMoney(schedule.terminated)}</dd>
          <dt>Remaining balance</dt><dd>{accountingMoney(schedule.remaining)}</dd>
          <dt>GL remaining</dt><dd>{accountingMoney(schedule.controlReconciliation.generalLedgerRemaining)} · {schedule.controlReconciliation.reconciled ? 'Matches schedule' : 'Variance reported by backend'}</dd>
          <dt>Source balance account ID</dt><dd>{schedule.balanceAccountId}</dd>
          <dt>Recognition account ID</dt><dd>{schedule.recognitionAccountId}</dd>
          <dt>Source journal / line</dt><dd>{schedule.relFkAccScheduleSource.journal.journalNumber} · <JournalLink id={schedule.relFkAccScheduleSource.journalId} /> · {schedule.sourceJournalLineId}
            {schedule.relFkAccScheduleSource.journal.revFkAccJournalReversal ? <> · Source reversed · <JournalLink id={schedule.relFkAccScheduleSource.journal.revFkAccJournalReversal.id} /></> : null}</dd>
          <dt>Linked AP/AR document</dt><dd>{schedule.accountingDocumentId && sourceSide ? <Link className={styles.link}
            href={documentLink(sourceSide, schedule.accountingDocumentId)}>View source document</Link> : schedule.accountingDocumentId ?? 'Not linked by backend'}</dd>
          <dt>Policy evidence</dt><dd>{schedule.policyEvidence}</dd>
          <dt>Recognition basis</dt><dd>{schedule.recognitionBasis}</dd>
          <dt>Revision</dt><dd>{schedule.revision}</dd>
          <dt>Termination journal</dt><dd><JournalLink id={schedule.terminationJournalId} />{schedule.terminationJournal?.revFkAccJournalReversal
            ? <> · Reversed · <JournalLink id={schedule.terminationJournal.revFkAccJournalReversal.id} /></> : null}</dd>
        </dl>
        {owner && ['DRAFT', 'ACTIVE'].includes(schedule.status) ? <div className={styles.actions}>
          {schedule.status === 'DRAFT' ? commandButton('SETUP') : null}
          {first ? commandButton('CHANGE') : null}{commandButton('CANCEL')}
          {schedule.status === 'ACTIVE' && positiveAmount(schedule.remaining) ? commandButton('TERMINATE') : null}
        </div> : null}
        <h2>Period allocations and journal history</h2>
        <p className={styles.note}>Amounts in this table are planned allocations. The journal and its reversal links show actual posting evidence.</p>
        <CoreReadState read={fiscal} />
        <CoreTable label="Schedule period allocations" headers={['Period / date', 'Planned amount', 'Recognition status', 'Journal evidence', 'Approval / action']}>
          {rows.map(row => {
            const reversal = row.relFkAccSchedulePeriodJournal?.revFkAccJournalReversal;
            const request = current(row.id, 'SCHEDULE_PERIOD');
            const available = schedule.status === 'ACTIVE' && row.id === first?.id && !schedule.relFkAccScheduleSource.journal.revFkAccJournalReversal;
            const blocked = available ? openDateReason(fiscal.data, row.recognitionDate.slice(0, 10)) : '';
            const state = reversal ? 'REVERSED' : row.recognitionJournalId ? 'POSTED' : available && !blocked ? 'ELIGIBLE_FOR_REVIEW' : 'UNPOSTED';
            return <tr key={row.id}><td>{periods.find(item => item.id === row.accountingPeriodId)?.periodCode ?? row.accountingPeriodId}<br />{row.recognitionDate.slice(0, 10)}</td>
              <td>{accountingMoney(row.plannedAmount)}</td><td><AccountingStatusIndicator status={state} /></td>
              <td><JournalLink id={row.recognitionJournalId} />{reversal ? <> · Reversal · <JournalLink id={reversal.id} /></> : null}</td>
              <td>{request ? <ApprovalLink id={request.id}>{request.status} · Open period approval</ApprovalLink>
                : available && owner && !blocked ? <Button variant="outline" onClick={() => setAction({ kind: 'PERIOD', row })}>Request period recognition</Button>
                  : blocked || '—'}</td>
            </tr>;
          })}
        </CoreTable>
        <SourceHistory approvals={schedule.approvalHistory} limit={schedule.approvalHistoryLimit} />
        {schedule.scheduleKind === 'DEFERRED_INCOME' ? <p className={styles.warning}>Donor restriction and deferred income are separate. Review fulfillment evidence for each recognition period.</p> : null}
      </> : null}
      {schedule && action ? <ScheduleAction schedule={schedule} action={action} onClose={() => setAction(null)} onDone={value => {
        setAction(null); setApprovalId(value); read.refresh();
      }} /> : null}
    </CoreCard>
  </CorePage>;
}

export function ScheduleWorkspace({ id, isNew, journalId = '' }: { id?: string; isNew?: boolean; journalId?: string }) {
  const user = useAuthSession();
  const manage = user.menuCodes.includes(journalPermissions.manage);
  if (id) return <ScheduleDetail key={id} id={id} />;
  if (isNew) return <CorePage title="New recognition schedule" description="Preview a schedule against an actual posted balance source.">
    <ScheduleLinks /><CoreCard>{manage ? <ScheduleForm journalId={journalId} /> : <p role="alert">Journal management permission is required to create a schedule.</p>}</CoreCard>
  </CorePage>;
  return <CorePage title="Prepayments & deferred income" description="Amortization, fulfillment evidence, and independently approved period recognition."
    actions={manage ? <Link className={styles.link} href="/accounting/schedules/new">New recognition schedule</Link> : undefined}>
    <ScheduleLinks /><CorePolicyNote /><CoreCard>
      <SourceList<ScheduleRow> path="schedules" title="Recognition schedules" kinds={scheduleKinds}
        kindOf={row => row.scheduleKind} referenceOf={row => row.scheduleReference} dateOf={row => row.startDate} />
    </CoreCard>
  </CorePage>;
}
