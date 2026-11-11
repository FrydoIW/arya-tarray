'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { CoreCard, CoreFeedback, CorePage, CoreReadState, CoreTable } from '../core/CoreUI';
import { useCoreRead } from '../core/hooks';
import { accountingMoney, decimalCents } from '../core/presentation';
import styles from '../core/core.module.css';
import { managementGrant, matchGrant, sourcePath, subledgerHref } from './api';
import { LinkedBankEvidence } from './BankEvidence';
import { DocumentForm } from './DocumentForm';
import { ApprovalLink, JournalLink } from './fields';
import { SettlementForm } from './SettlementForm';
import { SourceActions } from './SourceActions';
import { settlementName, SubledgerLinks, subledgerName } from './SubledgerLists';
import type { DocumentDetail, SettlementDetail, Side } from './types';

export function DocumentWorkspace({ side, id, edit }: { side: Side; id: string; edit: boolean }) {
  const user = useAuthSession();
  const path = sourcePath(side, 'documents', id);
  const read = useCoreRead<DocumentDetail>(path);
  const [result, setResult] = useState({ approvalId: '', message: '' });
  const row = read.data;
  const base = subledgerHref(side);
  const canManage = user.menuCodes.includes(managementGrant[side]);
  const ownsDraft = !!row && canManage && row.status === 'DRAFT' && row.createdById === user.id;
  const recognized = row?.status === 'RECOGNIZED' && row.financialState === 'POSTED';
  const kind = side === 'ap' ? 'AP_INVOICE' : 'AR_DOCUMENT';
  const usedRevision = row?.approvals.some(item => item.requestKind === kind && item.sourceVersion === row.revision);
  if (edit && row && ownsDraft && !read.loading && !read.error) return <DocumentForm side={side} existing={row} />;
  return <CorePage title={row?.documentNumber ?? subledgerName[side] + ' document'} description="Source, approval, allocation and journal evidence."
    actions={<Button variant="outline" disabled={read.loading} onClick={read.refresh}>Refresh document</Button>}>
    <SubledgerLinks side={side} />
    <CoreFeedback error="" message={result.message} />
    {result.approvalId ? <ApprovalLink id={result.approvalId} /> : null}
    <CoreCard><CoreReadState read={read} />
      {edit && row && !ownsDraft ? <p role="alert" className={styles.warning}>Only the authorized owner may edit a current draft.</p> : null}
      {row && !read.loading && !read.error ? <>
        <div className={styles.actions}><AccountingStatusIndicator status={row.status} /><AccountingStatusIndicator status={row.financialState} />
          {ownsDraft ? <Link className={styles.link} href={base + '/' + id + '?edit=1'}>Edit draft</Link> : null}
          {canManage && recognized && (decimalCents(row.outstanding) ?? BigInt(0)) > BigInt(0)
            ? <Link className={styles.link} href={base + '/settlements/new?counterpartyId=' + row.counterpartyId}>New {settlementName[side].toLowerCase()}</Link> : null}
        </div>
        <dl className={styles.details}>
          <dt>Counterparty</dt><dd><Link className={styles.link} href={'/accounting/counterparties?id=' + row.counterpartyId}>{row.relFkAccDocCounterparty.displayName}</Link></dd>
          <dt>Document / accounting / due dates</dt><dd>{row.documentDate} / {row.accountingDate} / {row.dueDate}</dd>
          <dt>Source ID / revision</dt><dd>{row.id} · {row.revision}</dd>
          <dt>Supporting reference</dt><dd>{row.sourceReference}</dd>
          <dt>Recognition evidence and basis</dt><dd>{row.recognitionBasis}</dd>
          <dt>Control account</dt><dd>{row.controlAccount ? row.controlAccount.code + ' · ' + row.controlAccount.name : row.controlAccountId}</dd>
          <dt>Original amount</dt><dd>{accountingMoney(row.originalAmount)}</dd>
          <dt>Posted outstanding</dt><dd>{recognized ? accountingMoney(row.outstanding) : 'Unavailable for this financial state'}</dd>
          <dt>Recognition journal</dt><dd><JournalLink id={row.recognitionJournalId} /></dd>
          <dt>Created by</dt><dd>{row.createdById}</dd>
        </dl>
        {ownsDraft && usedRevision ? <p className={styles.note}>This revision already has an approval record. Revise a rejected or cancelled draft before submitting again.</p> : null}
        <SourceActions side={side} path={path} revision={row.revision} accountingDate={row.accountingDate}
          onChanged={(approvalId, message) => { setResult({ approvalId, message }); read.refresh(); }}
          adjustment={{ outstanding: row.outstanding, controlAccountId: row.controlAccountId }}
          available={ownsDraft ? (usedRevision ? ['cancel'] : ['submit', 'cancel'])
            : canManage && recognized ? (side === 'ar' ? ['adjust', 'reverse'] : ['reverse']) : []} />
      </> : null}
    </CoreCard>
    {row && !read.loading && !read.error ? <>
      <CoreCard>
        <h2>Document lines</h2>
        <CoreTable label="Document evidence lines" headers={['Line', 'Offset account', 'Description', 'Amount', 'Fund / program']}>
          {row.lines.map(line => <tr key={line.id}><td>{line.lineNo}</td><td>{line.accountingAccountId}</td><td className={styles.wrap}>{line.description}</td>
            <td>{accountingMoney(line.amount)}</td><td>{line.accountingFundId ?? '—'} / {line.eventCampaignId ?? '—'}</td></tr>)}
        </CoreTable>
      </CoreCard>
      <CoreCard>
        <h2>Settlement history</h2>
        <p className={styles.note}>Up to {row.relatedRecordsLimit} related records. Draft and void allocations appear as evidence. Posted outstanding is reported separately.</p>
        {row.allocations.length ? <CoreTable label="Settlement history" headers={['Reference', 'Date', 'Allocation', 'Status', 'Journal']}>
          {row.allocations.map(item => {
            const settlement = item.relFkAccAllocationSettlement;
            return <tr key={item.id}><td><Link className={styles.link} href={base + '/settlements/' + settlement.id}>{settlement.settlementReference}</Link></td>
              <td>{settlement.settlementDate.slice(0, 10)}</td><td>{accountingMoney(item.allocatedAmount)}</td>
              <td>{settlement.status}</td><td><JournalLink id={settlement.postingJournalId} /></td></tr>;
          })}
        </CoreTable> : <p className={styles.note}>No related allocations returned.</p>}
        {row.adjustments.length ? <>
          <h3>Posted adjustment evidence</h3>
          <CoreTable label="Document adjustments" headers={['Reference', 'Kind', 'Amount', 'Reason', 'Journal']}>
            {row.adjustments.map(item => <tr key={item.id}><td>{item.adjustmentReference}</td><td>{item.adjustmentKind}</td>
              <td>{accountingMoney(item.amount)}</td><td className={styles.wrap}>{item.reason}</td><td><JournalLink id={item.adjustmentJournalId} /></td></tr>)}
          </CoreTable>
        </> : null}
      </CoreCard>
      <CoreCard>
        <h2>Approval records</h2>
        {row.approvals.length ? <CoreTable label="Document approvals" headers={['Request', 'Version', 'Status', 'Decision remark', 'Journal']}>
          {row.approvals.map(item => <tr key={item.id}><td><ApprovalLink id={item.id}>{item.requestKind}</ApprovalLink></td>
            <td>{item.sourceVersion}</td><td><AccountingStatusIndicator status={item.status} /></td>
            <td className={styles.wrap}>{item.decisionRemark ?? '—'}</td><td><JournalLink id={item.appliedJournalId} /></td></tr>)}
        </CoreTable> : <p className={styles.note}>No approval records returned for this source. Reversal requests use the original journal reference in Accounting Approval.</p>}
      </CoreCard>
    </> : null}
  </CorePage>;
}

const bankStateMessage: Record<string, string> = {
  AWAITING_STATEMENT: 'Posted settlement awaiting an imported bank transaction.',
  DRAFT_RESERVED: 'Imported bank evidence is reserved by this draft.',
  MATCHED_PENDING_FINALIZATION: 'Bank evidence is linked. Complete the existing statement workflow to finalize it.',
  RECONCILED: 'The linked transaction and statement are finalized.',
  BANK_REVIEW_REQUIRED: 'Review the linked evidence in the existing bank workflow.',
  VOID: 'This settlement is void. Any historical bank link remains audit evidence.'
};

export function SettlementWorkspace({ side, id, edit }: { side: Side; id: string; edit: boolean }) {
  const user = useAuthSession();
  const path = sourcePath(side, 'settlements', id);
  const read = useCoreRead<SettlementDetail>(path);
  const [result, setResult] = useState({ approvalId: '', message: '' });
  const row = read.data;
  const base = subledgerHref(side);
  const canManage = user.menuCodes.includes(managementGrant[side]);
  const ownsDraft = !!row && canManage && row.status === 'DRAFT' && row.createdById === user.id;
  const posted = row?.status === 'POSTED' && !!row.postingJournalId;
  const canMatch = posted && !row.bankTransactionId && user.menuCodes.includes(matchGrant);
  if (edit && row && ownsDraft && !read.loading && !read.error) return <SettlementForm side={side} existing={row} />;
  return <CorePage title={row?.settlementReference ?? settlementName[side]} description="Settlement allocation and imported bank evidence."
    actions={<Button variant="outline" disabled={read.loading} onClick={read.refresh}>Refresh settlement</Button>}>
    <SubledgerLinks side={side} />
    <CoreFeedback error="" message={result.message} />
    {result.approvalId ? <ApprovalLink id={result.approvalId} /> : null}
    <CoreCard><CoreReadState read={read} />
      {edit && row && !ownsDraft ? <p role="alert" className={styles.warning}>Only the authorized owner may edit a current draft.</p> : null}
      {row && !read.loading && !read.error ? <>
        <div className={styles.actions}><AccountingStatusIndicator status={row.status} /><AccountingStatusIndicator status={row.reconciliationState} />
          {ownsDraft ? <Link className={styles.link} href={base + '/settlements/' + id + '?edit=1'}>Edit draft</Link> : null}
        </div>
        {bankStateMessage[row.reconciliationState] ? <p className={styles.note}>{bankStateMessage[row.reconciliationState]}</p> : null}
        <dl className={styles.details}>
          <dt>Counterparty</dt><dd>{row.relFkAccSettlementCp.displayName}</dd>
          <dt>Date / amount</dt><dd>{row.settlementDate} · {accountingMoney(row.amount)}</dd>
          <dt>Source ID / revision</dt><dd>{row.id} · {row.revision}</dd>
          <dt>Supporting reference</dt><dd>{row.sourceReference}</dd>
          <dt>Bank account</dt><dd>{row.bankAccount.accountName} · {row.bankAccount.currencyCode}</dd>
          <dt>Bank GL account</dt><dd>{row.bankGlAccount.code} · {row.bankGlAccount.name}</dd>
          <dt>Posting journal</dt><dd><JournalLink id={row.postingJournalId} /></dd>
          <dt>Created by</dt><dd>{row.createdById}</dd>
        </dl>
        {row.relFkAccSettlementBank ? <LinkedBankEvidence bank={row.relFkAccSettlementBank} settlementId={row.id} /> : null}
        <SourceActions side={side} path={path} revision={row.revision} accountingDate={row.settlementDate} settlement={row}
          onChanged={(approvalId, message) => { setResult({ approvalId, message }); read.refresh(); }}
          available={ownsDraft ? (result.approvalId ? ['cancel'] : ['submit', 'cancel']) : [
            ...(posted && canManage ? ['reverse' as const] : []), ...(canMatch ? ['match' as const] : [])
          ]} />
        <Link className={styles.link} href="/accounting/approvals">Find settlement approvals and decisions</Link>
      </> : null}
    </CoreCard>
    {row && !read.loading && !read.error ? <CoreCard>
      <h2>Allocation evidence</h2>
      <CoreTable label="Settlement allocations" headers={['Document', 'Allocated amount']}>
        {row.allocations.map(item => <tr key={item.id}><td><Link className={styles.link} href={base + '/' + item.accountingDocumentId}>{item.accountingDocumentId}</Link></td>
          <td>{accountingMoney(item.allocatedAmount)}</td></tr>)}
      </CoreTable>
      <p className={styles.note}>The posting contract requires full allocation of the settlement amount. Use document detail or an as-of report for the remaining document balance.</p>
    </CoreCard> : null}
  </CorePage>;
}
