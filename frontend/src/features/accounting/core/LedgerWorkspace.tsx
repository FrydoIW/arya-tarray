"use client";
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { currentBusinessDayValue, currentBusinessMonthValue } from '@/lib/business-time';
import type { Ledger, Trial } from './types';
import { coreQuery } from './api';
import { useCoreRead, useCoreSelection } from './hooks';
import { CoreCard, CoreField, CoreInput, CorePage, CorePagination, CorePolicyNote, CoreReadState, CoreTable } from './CoreUI';
import { AccountLookupSearch, AccountSelect, useAccountLookup } from './AccountLookup';
import { FiscalScope, useFiscalYears } from './FiscalScope';
import { accountingMoney } from './presentation';
import { JournalDetailPanel } from './JournalWorkspace';
import { useState } from 'react';
import styles from './core.module.css';

export function LedgerWorkspace({ trial = false, initialScope = {} }: { trial?: boolean; initialScope?: Partial<{ accountId: string; yearId: string; periodId: string; from: string; to: string }> }) {
  const [filters, setFilters] = useCoreSelection(trial ? 'trial' : 'ledger', { accountId: '', yearId: '', periodId: '', from: `${currentBusinessMonthValue()}-01`, to: currentBusinessDayValue(), ...initialScope, page: 1 }, Object.keys(initialScope).length > 0);
  const fiscal = useFiscalYears(), lookup = useAccountLookup(), [journalId, setJournalId] = useState('');
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(filters.to) && (!filters.from || /^\d{4}-\d{2}-\d{2}$/.test(filters.from) && filters.from <= filters.to);
  const query = coreQuery({ from: filters.from, to: filters.to, accountId: filters.accountId, accountingPeriodId: filters.periodId, page: filters.page, pageSize: 25 });
  const ledger = useCoreRead<Ledger>(`general-ledger?${query}`, !trial && valid), balance = useCoreRead<Trial>(`trial-balance?${query}`, trial && valid), read = trial ? balance : ledger;
  const rows = lookup.read.data?.rows ?? [];
  const update = (next: Partial<typeof filters>) => setFilters({ ...filters, ...next, page: 1 });
  return <CorePage title={trial ? 'Trial Balance' : 'General Ledger'} description={trial ? 'Posted-account balances and cumulative backend control totals.' : 'Posted journal lines, opening balances and running movements from the central General Ledger.'} actions={<Button variant="outline" disabled={!valid || read.loading} onClick={read.refresh}>Refresh</Button>}>
    <CorePolicyNote /><CoreCard><div className={styles.filters}><FiscalScope value={filters} onChange={update} read={fiscal} />
      <CoreInput label="From date" type="date" value={filters.from} onChange={e => update({ from: e.target.value })} /><CoreInput label="To date" type="date" required value={filters.to} onChange={e => update({ to: e.target.value })} />
      <CoreField label="Account"><AccountSelect label="Ledger account" rows={rows} value={filters.accountId} onChange={accountId => update({ accountId })} /></CoreField>
    </div><AccountLookupSearch lookup={lookup} />{!valid ? <p role="alert" className={styles.warning}>Choose a valid end date and a start date no later than the end date.</p> : null}</CoreCard>
    <CoreCard><CoreReadState read={read} empty={read.data?.rows.length === 0} />
      {!trial && ledger.data && !ledger.loading && !ledger.error ? <>
        <div className={styles.summary}><span>Period debit: {accountingMoney(ledger.data.totalDebit)}</span><span>Period credit: {accountingMoney(ledger.data.totalCredit)}</span></div>
        <p className={styles.note}>Balances use debit minus credit. Missing returned balances are not replaced with invented values. Source-type filtering is not supported by this endpoint.</p>
        <CoreTable label="Opening and closing balances" headers={['Account ID', 'Opening balance', 'Closing balance']}>
          {[...new Set([...ledger.data.openingBalances.map(item => item.accountId), ...ledger.data.closingBalances.map(item => item.accountId)])].map(id => <tr key={id}><td>{rows.find(item => item.id === id)?.name ?? id}</td><td>{accountingMoney(ledger.data?.openingBalances.find(item => item.accountId === id)?.balance)}</td><td>{accountingMoney(ledger.data?.closingBalances.find(item => item.accountId === id)?.balance)}</td></tr>)}
        </CoreTable>
        <CoreTable label="General Ledger lines" headers={['Date', 'Journal', 'Account', 'Source type', 'Source reference', 'Debit', 'Credit', 'Running balance']}>
          {ledger.data.rows.map(row => <tr key={row.id}><td>{row.journal.accountingDate.slice(0, 10)}</td><td><Button variant="ghost" size="sm" onClick={() => setJournalId(row.journal.id)}>{row.journal.journalNumber}</Button></td><td>{row.accountCodeSnapshot} · {row.accountNameSnapshot}</td><td>{row.journal.sourceKind}</td><td className={styles.wrap}>{row.journal.sourceReference ?? 'Not supplied'}</td><td>{accountingMoney(row.debit)}</td><td>{accountingMoney(row.credit)}</td><td>{accountingMoney(row.runningBalance)}</td></tr>)}
        </CoreTable><CorePagination {...ledger.data} loading={ledger.loading} onPage={page => setFilters({ ...filters, page })} />
      </> : null}
      {trial && balance.data && !balance.loading && !balance.error ? <>
        <div className={styles.summary}><span>Cumulative debit: {accountingMoney(balance.data.totalDebit)}</span><span>Cumulative credit: {accountingMoney(balance.data.totalCredit)}</span><strong>{balance.data.balanced ? 'Backend totals balanced' : 'Backend totals unbalanced — review required'}</strong></div>
        <p className={styles.warning}>Totals are cumulative through {balance.data.asOf}, across all accounts in the backend scope; they are not sums of this page or the account selection. Balanced does not mean VERIFIED. This endpoint does not provide policy or unmapped-account verification.</p>
        <CoreTable label="Trial Balance accounts" headers={['Account', 'Type', 'Opening debit', 'Opening credit', 'Period debit', 'Period credit', 'Ending debit', 'Ending credit']}>
          {balance.data.rows.map(row => <tr key={row.id}><td><Link className={styles.link} href={`/accounting/general-ledger?${coreQuery({ accountId: row.id, from: filters.from, to: filters.to, accountingPeriodId: filters.periodId, fiscalYearId: filters.yearId })}`}>{row.code} · {row.name}</Link></td><td>{row.accountType}</td><td>{accountingMoney(row.openingDebit)}</td><td>{accountingMoney(row.openingCredit)}</td><td>{accountingMoney(row.movementDebit)}</td><td>{accountingMoney(row.movementCredit)}</td><td>{accountingMoney(row.closingDebit)}</td><td>{accountingMoney(row.closingCredit)}</td></tr>)}
        </CoreTable><CorePagination {...balance.data} loading={balance.loading} onPage={page => setFilters({ ...filters, page })} />
      </> : null}
    </CoreCard>{journalId ? <JournalDetailPanel id={journalId} onClose={() => setJournalId('')} /> : null}
  </CorePage>;
}
