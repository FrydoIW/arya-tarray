'use client';

import Link from 'next/link';
import { JournalLink, positiveAmount, validDay } from '../apar/fields';
import { CoreTable } from '../core/CoreUI';
import { accountingMoney, record, text } from '../core/presentation';
import { routeId } from '../core/route-scope';
import type { ApprovalDetail } from '../core/types';
import styles from '../core/core.module.css';

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record).filter((row): row is Record<string, unknown> => row !== null) : [];
}

export function readScheduleApproval(request: ApprovalDetail | null) {
  if (!request || !routeId(request.sourceDocumentId)) return null;
  const { requestKind, sourceDocumentId } = request;
  const accrual = ['ACCRUAL_DOCUMENT', 'ACCRUAL_ADJUSTMENT'].includes(requestKind);
  const period = requestKind === 'SCHEDULE_PERIOD';
  const commandKind = ['SCHEDULE_SETUP', 'SCHEDULE_CHANGE', 'SCHEDULE_CANCEL', 'SCHEDULE_TERMINATE'].includes(requestKind);
  if (!accrual && !period && !commandKind) return null;
  const source = record(request.source);
  const payload = record(request.requestPayload);
  const snapshot = record(payload?.snapshot);
  const schedule = period ? record(source?.schedule) : source;
  const header = record(snapshot?.header);
  const command = record(snapshot?.command);
  const periodSource = record(source?.row);
  const proposedRows = records(command?.periods);
  const savedRows = records(snapshot?.periods);
  const rows = accrual ? records(snapshot?.lines) : command?.action === 'CHANGE' ? proposedRows : savedRows;
  const metadata = record(snapshot?.metadata);
  const deferred = header?.kind === 'DEFERRED_INCOME';
  const recognitionEvidence = text(snapshot?.recognitionEvidence);
  const date = text(accrual ? snapshot?.accountingDate : period ? savedRows[0]?.date
    : command?.action === 'TERMINATE' ? command.accountingDate : header?.start).slice(0, 10);
  const sourceId = routeId(accrual ? text(snapshot?.parentAccrualDraftId ?? snapshot?.id) : text(header?.id));
  const liveVersion = accrual ? source?.revision : schedule?.revision;
  const live = ['PENDING', 'APPROVED'].includes(request.status);
  const identityMatches = accrual ? snapshot?.id === sourceDocumentId && source?.id === sourceDocumentId && snapshot?.sourceKind === requestKind
    : period ? savedRows.length === 1 && savedRows[0].id === sourceDocumentId && periodSource?.id === sourceDocumentId && header?.id === schedule?.id
      : header?.id === sourceDocumentId && schedule?.id === sourceDocumentId && 'SCHEDULE_' + text(command?.action) === requestKind;
  const contextAvailable = Boolean(sourceId && identityMatches && validDay(date) && rows.length && (accrual
    ? metadata && rows.length === 2 && typeof metadata.supportingEvidence === 'string'
    : header && ['PREPAYMENT', 'DEFERRED_INCOME'].includes(text(header.kind)) &&
      rows.every(row => routeId(text(row.accountingPeriodId)) && validDay(text(row.date ?? row.recognitionDate).slice(0, 10)) && positiveAmount(text(row.amount ?? row.plannedAmount))) &&
      (!period || !deferred || (typeof snapshot?.recognitionEvidence === 'string' && recognitionEvidence.trim().length >= 10))));
  const stale = live && (liveVersion !== request.sourceVersion || text(accrual ? snapshot?.revision : header?.revision) !== String(request.sourceVersion));
  return {
    accrual, period, date, stale, contextAvailable, rows, snapshot, metadata, header, command, recognitionEvidence,
    href: sourceId ? '/accounting/' + (accrual ? 'accruals/' : 'schedules/') + sourceId : '',
    postPath: accrual ? 'accruals/' + sourceDocumentId + '/post' : period ? 'schedule-periods/' + sourceDocumentId + '/post' : 'schedules/' + sourceDocumentId + '/apply',
    nonfinancial: commandKind && requestKind !== 'SCHEDULE_TERMINATE',
  };
}

type Evidence = NonNullable<ReturnType<typeof readScheduleApproval>>;
export function ScheduleApprovalEvidence({ evidence }: { evidence: Evidence }) {
  const { accrual, period, snapshot, metadata, header, command, rows, recognitionEvidence, href } = evidence;
  return <>
    <h3>{accrual ? 'Accrual recognition evidence' : 'Schedule approval evidence'}</h3>
    {href ? <Link className={styles.link} href={href}>Open Accounting source</Link> : null}
    {!evidence.contextAvailable ? <p role="alert" className={styles.warning}>The retained approval evidence or live source is incomplete. Review and posting are blocked.</p> : null}
    {accrual ? <>
      <dl className={styles.details}>
        <dt>Reference / kind</dt><dd>{text(snapshot?.sourceReference)} · {text(metadata?.kind)}</dd>
        <dt>Service period</dt><dd>{text(metadata?.serviceStart)} – {text(metadata?.serviceEnd)}</dd>
        <dt>Supporting evidence</dt><dd>{text(metadata?.supportingEvidence)}</dd>
        <dt>Recognition basis</dt><dd>{text(metadata?.recognitionBasis)}</dd>
        <dt>Policy reference</dt><dd>{text(metadata?.policyReference)}</dd>
        <dt>Planned reversal</dt><dd>{metadata?.scheduledReversalOn ? text(metadata.scheduledReversalOn) : 'Not opted in'}</dd>
        {metadata?.adjustmentKind ? <><dt>Adjustment reason</dt><dd>{text(metadata.adjustmentKind)} · {text(metadata.reason)}</dd></> : null}
      </dl>
      <CoreTable label="Requested accrual lines" headers={['Account', 'Debit', 'Credit', 'Counterparty ID']}>
        {rows.map((row, index) => <tr key={index}><td>{text(row.accountId)}</td><td>{accountingMoney(text(row.debit))}</td><td>{accountingMoney(text(row.credit))}</td><td>{text(row.counterpartyId)}</td></tr>)}
      </CoreTable>
    </> : <>
      <dl className={styles.details}>
        <dt>Kind / method</dt><dd>{text(header?.kind)} · {text(header?.method)}</dd>
        <dt>Service period</dt><dd>{text(header?.start)} – {text(header?.end)}</dd>
        <dt>Original scheduled amount</dt><dd>{accountingMoney(text(header?.amount))}</dd>
        <dt>Source journal line</dt><dd>{text(header?.sourceLine)}</dd>
        <dt>Balance / recognition accounts</dt><dd>{text(header?.balance)} / {text(header?.recognition)}</dd>
        <dt>Policy evidence</dt><dd>{text(header?.policy)}</dd>
        <dt>Recognition basis</dt><dd>{text(header?.basis)}</dd>
        {period ? <><dt>Period fulfillment evidence</dt><dd>{recognitionEvidence}</dd></> : <>
          <dt>Command</dt><dd>{text(command?.action)}</dd><dt>Command reason</dt><dd>{text(command?.reason)}</dd>
        </>}
      </dl>
      <CoreTable label="Requested schedule allocations" headers={['Period ID', 'Recognition date', 'Planned amount', 'Journal at request']}>
        {rows.map((row, index) => <tr key={index}><td>{text(row.accountingPeriodId)}</td><td>{text(row.date ?? row.recognitionDate)}</td>
          <td>{accountingMoney(text(row.amount ?? row.plannedAmount))}</td><td><JournalLink id={text(row.journal)} /></td></tr>)}
      </CoreTable>
    </>}
    <p className={styles.note}>Evidence comes from the retained request snapshot. The backend verifies the live digest before accepting a decision or applying approval.</p>
  </>;
}
