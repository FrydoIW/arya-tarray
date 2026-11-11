'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import { currentBusinessDayValue } from '@/lib/business-time';
import { managementGrant } from '../apar/api';
import { ApprovalLink, ChoiceField, JournalLink, MoneyField, positiveAmount, TextArea, validDay } from '../apar/fields';
import type { DocumentDetail } from '../apar/types';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { coreQuery } from '../core/api';
import { CoreCard, CoreFeedback, CoreInput, CorePage, CorePolicyNote, CoreReadState, CoreTable } from '../core/CoreUI';
import { journalPermissions } from '../core/contracts.generated';
import { openDateReason, useFiscalYears } from '../core/FiscalScope';
import { useCoreRead } from '../core/hooks';
import { accountingMoney, decimalCents } from '../core/presentation';
import styles from '../core/core.module.css';
import { AccrualForm } from './AccrualForm';
import { accrualSide, ClearingForm, documentArea, documentLink } from './ClearingForm';
import { adjustAccrual, requestAccrualReversal, requestScheduledReversal, submitAccrual } from './api';
import { ActionReview, ScheduleLinks, SourceHistory } from './ScheduleUI';
import { SourceList } from './SourceList';
import type { Accrual, AccrualAdjustment, AccrualRow, ApprovalResult, DueReversals } from './types';

const kinds = [{ id: 'ACCRUED_EXPENSE', label: 'Accrued expense' }, { id: 'ACCRUED_INCOME', label: 'Accrued income' }];
type Action = { kind: 'SUBMIT'; draft: Pick<AccrualRow, 'id' | 'revision' | 'accountingDate'> } | { kind: 'ADJUST' | 'REVERSE' | 'SCHEDULED' };

function AccrualAction({ source, action, onClose, onDone }: {
  source: Accrual; action: Action; onClose: () => void; onDone: (message: string, approvalId?: string) => void;
}) {
  const fiscal = useFiscalYears();
  const [date, setDate] = useState(action.kind === 'SUBMIT' ? action.draft.accountingDate.slice(0, 10)
    : action.kind === 'SCHEDULED' ? source.metadata.scheduledReversalOn?.slice(0, 10) ?? '' : '');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [direction, setDirection] = useState<AccrualAdjustment['adjustmentKind']>('INCREASE');
  const adjustment = action.kind === 'ADJUST';
  const submit = action.kind === 'SUBMIT';
  function validate() {
    if (!validDay(date)) return 'Enter a valid accounting date.';
    if (!submit && !adjustment && source.postedJournal && date < source.postedJournal.accountingDate.slice(0, 10)) return 'Reversal cannot predate the original journal.';
    if (!submit && reason.trim().length < 10) return 'Enter an audit reason of at least 10 characters.';
    if (adjustment) {
      const cents = positiveAmount(amount);
      if (cents === null || !reference.trim()) return 'Enter a reference and a positive exact adjustment amount.';
      if (direction === 'DECREASE' && cents > (decimalCents(source.remaining) ?? BigInt(0))) return 'Decrease exceeds the backend remaining balance.';
      return '';
    }
    return openDateReason(fiscal.data, date);
  }
  async function run(): Promise<ApprovalResult> {
    if (action.kind === 'SUBMIT') return { approvalId: (await submitAccrual(action.draft.id, action.draft.revision)).id };
    if (adjustment) {
      await adjustAccrual(source.id, { accountingDate: date, adjustmentKind: direction, reason: reason.trim(), sourceReference: reference.trim(), amount });
      return {};
    }
    const approval = action.kind === 'SCHEDULED' ? await requestScheduledReversal(source.id, reason.trim())
      : await requestAccrualReversal(source.id, date, reason.trim());
    return { approvalId: approval.id };
  }
  return <ActionReview title={submit ? 'Submit accrual for approval' : adjustment ? 'Create adjustment draft'
    : action.kind === 'SCHEDULED' ? 'Request scheduled reversal' : 'Request accrual reversal'}
    description={adjustment ? 'The original journal is retained. Submit the separate adjustment for independent approval after saving.'
      : 'The request is routed to an independent reviewer. Posting is a separate authorized action.'}
    onClose={onClose} onDone={result => onDone(adjustment ? 'Adjustment draft saved.' : 'Approval request created.', result.approvalId)}
    validate={validate} run={run} fields={<>
      {!adjustment ? <CoreReadState read={fiscal} /> : null}
      <CoreInput label="Action accounting date" type="date" value={date} readOnly={submit || action.kind === 'SCHEDULED'} onChange={event => setDate(event.target.value)} />
      {adjustment ? <div className={styles.formGrid}>
        <CoreInput label="Adjustment reference" value={reference} maxLength={110} onChange={event => setReference(event.target.value)} />
        <ChoiceField label="Adjustment direction" value={direction} onChange={value => {
          if (value === 'INCREASE' || value === 'DECREASE') setDirection(value);
        }} choices={[{ id: 'INCREASE', label: 'Increase' }, { id: 'DECREASE', label: 'Decrease' }]} />
        <MoneyField label="Adjustment amount" value={amount} onChange={setAmount} />
      </div> : null}
      {!submit ? <TextArea label="Audit reason" value={reason} onChange={setReason} minLength={10} maxLength={1000} /> : null}
      {!submit && !adjustment ? <div>Original journal · {source.postedJournal?.journalNumber} · <JournalLink id={source.postedJournalId} /></div> : null}
    </>} />;
}

function ClearingEvidence({ source }: { source: Accrual }) {
  const [selected, setSelected] = useState('');
  const side = accrualSide(source.metadata.kind);
  const read = useCoreRead<DocumentDetail>(side + '/documents/' + selected, !!selected);
  const detail = read.data;
  return <>
    <h2>{side.toUpperCase()} clearing and settlement</h2>
    <p className={styles.note}>Clearing transfers the accrued balance to the AP/AR control account. Settlement is recorded separately against the resulting document.</p>
    {source.clearingDocuments.length ? <CoreTable label="Linked clearing documents" headers={['Document', 'Status', 'Recognition journal', 'Settlement evidence']}>
      {source.clearingDocuments.map(row => <tr key={row.id}>
        <td><Link className={styles.link} href={documentLink(side, row.id)}>{row.documentNumber}</Link></td>
        <td><AccountingStatusIndicator status={row.status} /></td><td><JournalLink id={row.recognitionJournalId} /></td>
        <td><Button variant="outline" onClick={() => setSelected(row.id)}>Inspect settlement</Button></td>
      </tr>)}
    </CoreTable> : <p>No linked clearing documents returned.</p>}
    {selected ? <><CoreReadState read={read} />{detail && !read.loading && !read.error ? <>
      <h3>Settlement for {detail.documentNumber}</h3>
      <p>{detail.financialState} · Backend outstanding {accountingMoney(detail.outstanding)}</p>
      {detail.allocations.length ? <CoreTable label="Settlement allocations" headers={['Settlement', 'Status', 'Allocated amount', 'Journal']}>
        {detail.allocations.map(row => {
          const settlement = row.relFkAccAllocationSettlement;
          return <tr key={row.id}><td><Link className={styles.link} href={'/accounting/' + documentArea(side) + '/settlements/' + settlement.id}>{settlement.settlementReference}</Link></td>
            <td><AccountingStatusIndicator status={settlement.status} /></td><td>{accountingMoney(row.allocatedAmount)}</td><td><JournalLink id={settlement.postingJournalId} /></td></tr>;
        })}
      </CoreTable> : <p>No settlement allocations returned.</p>}
    </> : null}</> : null}
  </>;
}

function AccrualDetail({ id, clearing }: { id: string; clearing?: boolean }) {
  const user = useAuthSession();
  const read = useCoreRead<Accrual>('accruals/' + id);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; approvalId?: string } | null>(null);
  const [reversalRequest, setReversalRequest] = useState('');
  const source = read.data;
  const editable = user.menuCodes.includes(journalPermissions.manage) && source?.createdById === user.id && source.status === 'DRAFT';
  const canManage = user.menuCodes.includes(journalPermissions.manage);
  const reversed = source?.postedJournal?.revFkAccJournalReversal;
  const posted = !!source?.postedJournal && !reversed;
  const side = source ? accrualSide(source.metadata.kind) : 'ap';
  const canClear = posted && (decimalCents(source?.remaining ?? '') ?? BigInt(0)) > BigInt(0) && user.menuCodes.includes(managementGrant[side]);
  const currentApproval = source?.approvalHistory.find(item => item.sourceVersion === source.revision && ['PENDING', 'APPROVED'].includes(item.status));
  return <CorePage title={clearing ? 'Clear accrual' : 'Accrual detail'} description="Recognition evidence, General Ledger, and the linked clearing lifecycle.">
    <ScheduleLinks /><CoreCard><CoreReadState read={read} />
      <CoreFeedback error="" message={feedback?.message ?? ''} />
      {feedback?.approvalId ? <ApprovalLink id={feedback.approvalId} /> : null}
      {source && !read.loading && !read.error ? <>
        {clearing ? canClear ? <ClearingForm source={source} /> : <p role="alert" className={styles.warning}>A posted unreversed accrual with a positive balance and {side.toUpperCase()} management access is required.</p> : <>
          <div className={styles.actions}><h2>{source.sourceReference}</h2><AccountingStatusIndicator status={source.status} /><AccountingStatusIndicator status={source.reconciliation} />
            <Button variant="outline" onClick={read.refresh}>Refresh accrual</Button></div>
          <dl className={styles.details}>
            <dt>Accrual kind</dt><dd>{kinds.find(kind => kind.id === source.metadata.kind)?.label}</dd>
            <dt>Accounting date / revision</dt><dd>{source.accountingDate.slice(0, 10)} · {source.revision}</dd>
            <dt>Service period</dt><dd>{source.metadata.serviceStart.slice(0, 10)} – {source.metadata.serviceEnd.slice(0, 10)}</dd>
            <dt>Recognition account ID</dt><dd>{source.recognition.accountId}</dd>
            <dt>Accrued balance account ID</dt><dd>{source.balance.accountId}</dd>
            <dt>Counterparty ID</dt><dd>{source.balance.counterpartyId ?? 'Not linked'}</dd>
            <dt>Recognition evidence</dt><dd>{source.metadata.supportingEvidence}</dd>
            <dt>Recognition basis</dt><dd>{source.metadata.recognitionBasis}</dd>
            <dt>Policy reference</dt><dd>{source.metadata.policyReference}</dd>
            <dt>Original amount</dt><dd>{accountingMoney(source.originalAmount)}</dd>
            <dt>Recognized</dt><dd>{accountingMoney(source.recognized)}</dd>
            <dt>Cleared</dt><dd>{accountingMoney(source.cleared)}</dd>
            <dt>Remaining accrued balance</dt><dd>{accountingMoney(source.remaining)}</dd>
            <dt>GL balance / variance</dt><dd>{accountingMoney(source.controlReconciliation.generalLedger)} / {accountingMoney(source.controlReconciliation.variance)}</dd>
            <dt>Original journal</dt><dd>{source.postedJournal?.journalNumber ?? 'Unposted'} · <JournalLink id={source.postedJournalId} /></dd>
            <dt>Planned reversal</dt><dd>{source.metadata.scheduledReversalOn?.slice(0, 10) ?? 'Not opted in'}</dd>
            <dt>Reversal journal</dt><dd>{reversed ? <>Reversed · {reversed.journalNumber} · <JournalLink id={reversed.id} /></> : 'No posted reversal'}</dd>
          </dl>
          <div className={styles.actions}>
            {editable ? <><Button variant="outline" onClick={() => setEditing(!editing)}>{editing ? 'Close draft editor' : 'Edit draft'}</Button>
              {currentApproval ? <ApprovalLink id={currentApproval.id}>Review current approval</ApprovalLink>
                : <Button onClick={() => setAction({ kind: 'SUBMIT', draft: source })}>Submit accrual for approval</Button>}</> : null}
            {posted && canManage ? <>
              <Button variant="outline" onClick={() => setAction({ kind: 'ADJUST' })}>New adjustment</Button>
              {reversalRequest ? <ApprovalLink id={reversalRequest}>Review reversal request</ApprovalLink> : <>
                <Button variant="outline" onClick={() => setAction({ kind: 'REVERSE' })}>Request reversal</Button>
                {source.metadata.scheduledReversalOn ? <Button variant="outline" onClick={() => setAction({ kind: 'SCHEDULED' })}>Request scheduled reversal</Button> : null}
              </>}
            </> : null}
            {canClear ? <Link className={styles.link} href={'/accounting/accruals/' + id + '/clearing'}>Create linked {side.toUpperCase()} clearing draft</Link> : null}
          </div>
          {editable && editing ? <AccrualForm key={source.revision} existing={source} onSaved={() => {
            setEditing(false); setFeedback({ message: 'Accrual revision saved.' }); read.refresh();
          }} /> : null}
          <h2>Adjustments and journals</h2>
          {source.adjustments.length ? <CoreTable label="Accrual adjustments" headers={['Reference / reason', 'Date', 'Status', 'Journal', 'Approval']}>
            {source.adjustments.map(row => <tr key={row.id}><td>{row.sourceReference}<br />{row.accrualMetadata.adjustmentKind} · {row.accrualMetadata.reason}</td>
              <td>{row.accountingDate.slice(0, 10)}</td><td><AccountingStatusIndicator status={row.status} /></td><td><JournalLink id={row.postedJournalId} /></td>
              <td>{canManage && row.status === 'DRAFT' && row.createdById === user.id ? <Button variant="outline" onClick={() => setAction({ kind: 'SUBMIT', draft: row })}>Submit adjustment</Button> : '—'}</td>
            </tr>)}
          </CoreTable> : <p>No adjustments returned.</p>}
          <ClearingEvidence source={source} />
          <SourceHistory approvals={source.approvalHistory} limit={source.relatedRecordsLimit} />
          <p className={styles.note}>Reversal decisions are retained in Accounting Approval. The accrual endpoint supplies the posted reversal journal. Use the request ID to revisit a pending decision.</p>
        </>}
      </> : null}
      {source && action ? <AccrualAction action={action} source={source} onClose={() => setAction(null)} onDone={(message, approvalId) => {
        if (approvalId && (action.kind === 'REVERSE' || action.kind === 'SCHEDULED')) setReversalRequest(approvalId);
        setAction(null); setFeedback({ message, approvalId }); read.refresh();
      }} /> : null}
    </CoreCard>
  </CorePage>;
}

function ScheduledReversals() {
  const [asOf, setAsOf] = useState(() => currentBusinessDayValue());
  const [page, setPage] = useState(1);
  const read = useCoreRead<DueReversals>('accruals/scheduled-reversals?' + coreQuery({ asOf, page, pageSize: 25 }), validDay(asOf));
  return <CorePage title="Scheduled accrual reversals" description="Opt-in accruals due by date. Each reversal requires separate approval and authorized posting.">
    <ScheduleLinks /><CoreCard><div className={styles.toolbar}><CoreInput label="Due as of" type="date" value={asOf} onChange={event => { setAsOf(event.target.value); setPage(1); }} /></div>
      {validDay(asOf) ? <><CoreReadState read={read} empty={read.data?.rows.length === 0} />
        {read.data && !read.loading && !read.error ? <>
          {read.data.rows.length ? <CoreTable label="Due scheduled reversals" headers={['Accrual', 'Planned date']}>
            {read.data.rows.map(row => <tr key={row.id}><td><Link className={styles.link} href={'/accounting/accruals/' + row.id}>Open accrual · {row.id}</Link></td><td>{row.scheduledDate}</td></tr>)}
          </CoreTable> : null}
          <div className={styles.actions}><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span>Page {page}</span><Button variant="outline" disabled={read.data.rows.length < read.data.pageSize} onClick={() => setPage(page + 1)}>Next</Button></div>
        </> : null}
      </> : <p role="alert">Enter a valid due date.</p>}
    </CoreCard>
  </CorePage>;
}

export function AccrualWorkspace({ mode, id }: { mode: 'list' | 'new' | 'detail' | 'clearing' | 'reversals'; id?: string }) {
  const user = useAuthSession();
  const manage = user.menuCodes.includes(journalPermissions.manage);
  if (mode === 'reversals') return <ScheduledReversals />;
  if (id) return <AccrualDetail key={id + mode} id={id} clearing={mode === 'clearing'} />;
  if (mode === 'new') return <CorePage title="New accrual draft" description="Record a supported expense or income recognition with evidence.">
    <ScheduleLinks /><CoreCard>{manage ? <AccrualForm /> : <p role="alert">Journal management permission is required to create an accrual.</p>}</CoreCard>
  </CorePage>;
  return <CorePage title="Accruals" description="Accrued expenses and earned income, with clearing and reversal traceability."
    actions={manage ? <Link className={styles.link} href="/accounting/accruals/new">New accrual draft</Link> : undefined}>
    <ScheduleLinks /><CorePolicyNote /><CoreCard>
      <SourceList<AccrualRow> path="accruals" title="Accrual records" kinds={kinds} kindOf={row => row.accrualMetadata.kind}
        referenceOf={row => row.sourceReference} dateOf={row => row.accountingDate} />
    </CoreCard>
  </CorePage>;
}
