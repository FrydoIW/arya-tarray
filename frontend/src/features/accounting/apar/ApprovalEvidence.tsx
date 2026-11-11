'use client';

import Link from 'next/link';
import { CoreTable } from '../core/CoreUI';
import { accountingMoney, record, text } from '../core/presentation';
import { routeId } from '../core/route-scope';
import type { ApprovalDetail } from '../core/types';
import styles from '../core/core.module.css';
import { sourcePath, subledgerHref } from './api';
import { validDay } from './fields';
import type { Side, Source } from './types';

const aparKinds = ['AP_INVOICE', 'AR_DOCUMENT', 'SETTLEMENT', 'AR_ADJUSTMENT'];

function readRows(value: unknown) {
  return Array.isArray(value) ? value.map(record).filter((item): item is Record<string, unknown> => item !== null) : [];
}

export function readAparApproval(request: ApprovalDetail | null) {
  if (!request || !aparKinds.includes(request.requestKind)) return null;
  const source = record(request.source);
  const settlement = request.requestKind === 'SETTLEMENT';
  const adjustment = request.requestKind === 'AR_ADJUSTMENT' ? record(source?.adjustment) : null;
  const row = record(settlement ? source?.settlement : source?.document);
  const kind = settlement ? row?.settlementKind : row?.documentKind;
  if (!row || row.id !== request.sourceDocumentId || !routeId(request.sourceDocumentId)
    || (kind !== 'PAYABLE' && kind !== 'RECEIVABLE')) return null;
  if (request.requestKind === 'AP_INVOICE' && kind !== 'PAYABLE') return null;
  if (['AR_DOCUMENT', 'AR_ADJUSTMENT'].includes(request.requestKind) && kind !== 'RECEIVABLE') return null;
  if (request.requestKind === 'AR_ADJUSTMENT' && !adjustment) return null;
  const side: Side = kind === 'PAYABLE' ? 'ap' : 'ar';
  const group: Source = settlement ? 'settlements' : 'documents';
  const date = text(adjustment?.accountingDate ?? (settlement ? row.settlementDate : row.accountingDate)).slice(0, 10);
  const lines = readRows(settlement ? row.revFkAccAllocationSettlement : row.revFkAccDocLineDoc);
  const party = record(settlement ? row.relFkAccSettlementCp : row.relFkAccDocCounterparty);
  const reference = text(settlement ? row.settlementReference : row.documentNumber);
  const contextAvailable = validDay(date) && lines.length > 0 && typeof row.sourceReference === 'string'
    && (settlement ? typeof row.amount === 'string' && typeof row.bankGlAccountId === 'string'
      : typeof row.recognitionBasis === 'string' && typeof row.controlAccountId === 'string');
  const editableStatus = adjustment ? 'RECOGNIZED' : 'DRAFT';
  const stale = ['PENDING', 'APPROVED'].includes(request.status)
    && (row.status !== editableStatus || (!adjustment && row.revision !== request.sourceVersion));
  return {
    side, row, settlement, adjustment, date, lines, party, reference, contextAvailable, stale,
    href: subledgerHref(side) + (settlement ? '/settlements/' : '/') + request.sourceDocumentId,
    postPath: adjustment ? null : sourcePath(side, group, request.sourceDocumentId)
  };
}

type Evidence = NonNullable<ReturnType<typeof readAparApproval>>;

export function AparApprovalEvidence({ evidence }: { evidence: Evidence }) {
  const { side, row, settlement, adjustment, date, party, reference, href, lines } = evidence;
  return <>
    <h3>{settlement ? 'Settlement allocation evidence' : 'AP/AR source evidence'}</h3>
    <Link className={styles.link} href={href}>Open source · {reference}</Link>
    <dl className={styles.details}>
      <dt>Source reference</dt><dd>{text(row.sourceReference)}</dd>
      <dt>Counterparty</dt><dd>{text(party?.displayName ?? row.counterpartyId)}</dd>
      <dt>Source status / revision</dt><dd>{text(row.status)} · {text(row.revision)}</dd>
      <dt>Accounting date</dt><dd>{date}</dd>
      {settlement ? <>
        <dt>Settlement amount</dt><dd>{accountingMoney(text(row.amount))}</dd>
        <dt>Bank GL account</dt><dd>{text(row.bankGlAccountId)}</dd>
        <dt>Imported bank link</dt><dd>{row.bankTransactionId ? text(row.bankTransactionId) : 'Awaiting imported evidence after posting'}</dd>
      </> : <>
        <dt>Due date</dt><dd>{text(row.dueDate).slice(0, 10)}</dd>
        <dt>Recognition basis</dt><dd>{text(row.recognitionBasis)}</dd>
        <dt>Control account</dt><dd>{text(row.controlAccountId)}</dd>
      </>}
      {adjustment ? <>
        <dt>Adjustment</dt><dd>{text(adjustment.adjustmentKind)} · {accountingMoney(text(adjustment.amount))} · {text(adjustment.adjustmentReference)}</dd>
        <dt>Offset and reason</dt><dd>{text(adjustment.offsetAccountId)} · {text(adjustment.reason)}</dd>
      </> : null}
    </dl>
    <CoreTable label={settlement ? 'Approval allocations' : 'Approval document lines'} headers={settlement ? ['Document', 'Allocation'] : ['Offset account', 'Description', 'Amount', 'Fund / program']}>
      {lines.map((line, index) => <tr key={index}>{settlement ? <>
        <td><Link className={styles.link} href={subledgerHref(side) + '/' + text(line.accountingDocumentId)}>{text(line.accountingDocumentId)}</Link></td>
        <td>{accountingMoney(text(line.allocatedAmount))}</td>
      </> : <>
        <td>{text(line.accountingAccountId)}</td><td className={styles.wrap}>{text(line.description)}</td>
        <td>{accountingMoney(text(line.amount))}</td><td>{text(line.accountingFundId)} / {text(line.eventCampaignId)}</td>
      </>}</tr>)}
    </CoreTable>
  </>;
}
