'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import { getTransactionInquiryDetail, getTransactionInquiryWorkspace } from '@/features/reconciliation/transaction-inquiry/api/transaction-inquiry.api';
import { useAccountingRead } from '../hooks/useAccountingRead';
import { CoreInput, CorePagination, CoreReadState, CoreTable } from '../core/CoreUI';
import { accountingMoney, decimalCents } from '../core/presentation';
import styles from '../core/core.module.css';
import { inquiryGrant } from './api';
import { positiveAmount, validDay } from './fields';
import type { LinkedBank, Side } from './types';

export function BankEvidencePicker({ side, bankAccountId, amount, date, value, onChange }: {
  side: Side; bankAccountId: string; amount: string; date: string; value: string; onChange: (id: string) => void;
}) {
  const user = useAuthSession();
  const canInquire = user.menuCodes.includes(inquiryGrant);
  const [open, setOpen] = useState(false);
  const [lookupDate, setLookupDate] = useState(date);
  const [page, setPage] = useState(1);
  const load = useCallback((signal: AbortSignal) => getTransactionInquiryWorkspace({
    periodMode: 'DAY', date: lookupDate, month: '', search: '', status: 'ALL', bankAccountId,
    finalEventId: 'ALL', eventCampaignId: 'ALL', memberId: 'ALL', memberLinkStatus: 'ALL', page, pageSize: 25
  }, signal), [bankAccountId, lookupDate, page]);
  const cents = positiveAmount(amount);
  const enabled = open && canInquire && !!bankAccountId && validDay(lookupDate) && cents !== null;
  const read = useAccountingRead('apar-bank:' + user.id + ':' + bankAccountId + ':' + lookupDate + ':' + page, load, enabled, true);
  const expected = cents === null ? null : side === 'ap' ? -cents : cents;
  const candidates = read.data?.transactions.filter(row =>
    row.sourceType === 'BANK' && row.transactionDate && row.bankAccount.id === bankAccountId
    && row.bankAccount.currencyCode === 'IDR' && expected !== null && decimalCents(row.originalAmount) === expected) ?? [];
  return <div className={styles.page}>
    <CoreInput label="Imported bank transaction ID" value={value} maxLength={36} onChange={event => onChange(event.target.value.trim())} />
    <p className={styles.note}>Use an existing imported transaction UUID. The backend checks account, direction, exact amount, exclusions and prior recognition.</p>
    {canInquire ? <Button variant="outline" onClick={() => setOpen(!open)}>{open ? 'Hide imported transactions' : 'Find imported transactions'}</Button> : null}
    {open && canInquire ? <>
      <CoreInput label="Bank transaction date" type="date" value={lookupDate} onChange={event => { setLookupDate(event.target.value); setPage(1); }} />
      {!enabled ? <p className={styles.note}>Choose a bank account, a valid lookup date and a positive amount.</p> : <>
        <CoreReadState read={read} />
        {read.data && !read.loading && !read.error ? <>
          <p className={styles.note}>Exact amount and direction candidates on this inquiry page. Other pages may contain additional matches.</p>
          {candidates.length ? <CoreTable label="Imported bank candidates" headers={['Reference', 'Amount', 'Bank lifecycle', 'Select']}>
            {candidates.map(row => <tr key={row.id}><td>{row.referenceNo ?? row.id}</td><td>{accountingMoney(row.originalAmount)}</td>
              <td>{row.status}</td><td><Button variant="outline" size="sm" onClick={() => onChange(row.id)}>Use {row.referenceNo ?? row.id}</Button></td></tr>)}
          </CoreTable> : <p className={styles.note}>No matching imported transactions on this page.</p>}
          <CorePagination {...read.data.pagination} loading={read.loading} onPage={setPage} />
        </> : null}
      </>}
      <Link className={styles.link} href="/reconciliation/transaction-inquiry">Open Transaction Inquiry</Link>
    </> : null}
  </div>;
}

export function LinkedBankEvidence({ bank, settlementId }: { bank: LinkedBank; settlementId: string }) {
  const user = useAuthSession();
  const canInquire = user.menuCodes.includes(inquiryGrant);
  const [showHistory, setShowHistory] = useState(false);
  const load = useCallback((signal: AbortSignal) => getTransactionInquiryDetail(bank.id, signal), [bank.id]);
  const read = useAccountingRead('apar-bank-detail:' + user.id + ':' + bank.id, load, showHistory && canInquire, true);
  const events = read.data?.history.filter(row => row.fieldName === 'accounting_settlement_active'
    && (row.oldValue === settlementId || row.newValue === settlementId));
  return <>
    <dl className={styles.details}>
      <dt>Bank transaction</dt><dd>{bank.id}</dd>
      <dt>Bank reference</dt><dd>{bank.referenceNo ?? 'Unavailable'}</dd>
      <dt>Bank date and amount</dt><dd>{bank.transactionDate?.slice(0, 10) ?? 'Unavailable'} · {accountingMoney(bank.originalAmount)}</dd>
      <dt>Statement</dt><dd>{bank.statementUpload.fileName} · {bank.statementUpload.id}</dd>
      <dt>Transaction / statement status</dt><dd>{bank.status} / {bank.statementUpload.status}</dd>
    </dl>
    {canInquire ? <Button variant="outline" onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'Hide bank matching history' : 'Read bank matching history'}</Button> : null}
    {showHistory && canInquire ? <>
      <CoreReadState read={read} />
      {events && !read.loading && !read.error ? events.length ? <CoreTable label="Bank matching history" headers={['Action', 'Time', 'Evidence']}>
        {events.map(row => <tr key={row.id}><td>{row.changedBy.fullName}</td><td>{row.changedAt}</td><td className={styles.wrap}>{row.remark ?? '—'}</td></tr>)}
      </CoreTable> : <p className={styles.note}>No matching event was returned in the inquiry history.</p> : null}
    </> : null}
  </>;
}
