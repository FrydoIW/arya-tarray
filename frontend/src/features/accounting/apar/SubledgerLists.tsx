'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable/DataTable';
import type { DataTableColumn } from '@/components/ui/DataTable/types';
import { SearchInput } from '@/components/ui/SearchInput';
import { Select } from '@/components/ui/Select';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import { currentBusinessDayValue } from '@/lib/business-time';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import type { AccountingPage } from '../types';
import { coreQuery } from '../core/api';
import { CoreCard, CoreInput, CorePage, CorePolicyNote, CoreReadState } from '../core/CoreUI';
import { useCoreRead, useCoreSelection } from '../core/hooks';
import { accountingMoney } from '../core/presentation';
import styles from '../core/core.module.css';
import { managementGrant, sourcePath, subledgerHref } from './api';
import { JournalLink, PartyChoice, validDay } from './fields';
import type { DocumentRow, Outstanding, OutstandingRow, SettlementRow, Side, Source } from './types';

export const subledgerName = { ap: 'Accounts Payable', ar: 'Accounts Receivable' } as const;
export const settlementName = { ap: 'Payment', ar: 'Receipt' } as const;

export function SubledgerLinks({ side, view }: { side: Side; view?: string }) {
  const base = subledgerHref(side);
  const links = [
    ['', side === 'ap' ? 'Invoices' : 'Receivables'],
    ['/settlements', settlementName[side] + 's'],
    ['/outstanding', 'Outstanding'],
    ['/aging', 'Aging']
  ];
  return <nav className={styles.toolbar} aria-label={subledgerName[side] + ' views'}>
    {links.map(([path, label]) => <Link key={path} className={styles.link} href={base + path}
      aria-current={view === path ? 'page' : undefined}>{label}</Link>)}
    <Link className={styles.link} href="/accounting/counterparties">Counterparties</Link>
  </nav>;
}

const documentColumns = (base: string): DataTableColumn<DocumentRow>[] => [
  { key: 'documentNumber', header: 'Document', render: row => <Link className={styles.link} href={base + '/' + row.id}>{row.documentNumber}</Link> },
  { key: 'party', header: 'Counterparty', render: row => row.relFkAccDocCounterparty.displayName },
  { key: 'documentDate', header: 'Document date' },
  { key: 'accountingDate', header: 'Accounting date' },
  { key: 'dueDate', header: 'Due date' },
  { key: 'originalAmount', header: 'Original amount', align: 'right', render: row => accountingMoney(row.originalAmount) },
  { key: 'status', header: 'Document status', render: row => <AccountingStatusIndicator status={row.status} /> },
  { key: 'journal', header: 'Recognition journal', render: row => <JournalLink id={row.recognitionJournalId} /> }
];

const settlementColumns = (base: string): DataTableColumn<SettlementRow>[] => [
  { key: 'settlementReference', header: 'Reference', render: row => <Link className={styles.link} href={base + '/settlements/' + row.id}>{row.settlementReference}</Link> },
  { key: 'settlementDate', header: 'Settlement date' },
  { key: 'amount', header: 'Amount', align: 'right', render: row => accountingMoney(row.amount) },
  { key: 'status', header: 'Source status', render: row => <AccountingStatusIndicator status={row.status} /> },
  { key: 'reconciliationState', header: 'Bank status', render: row => <AccountingStatusIndicator status={row.reconciliationState} /> },
  { key: 'journal', header: 'Posting journal', render: row => <JournalLink id={row.postingJournalId} /> }
];

export function SubledgerList({ side, source, initialParty }: { side: Side; source: Source; initialParty: string }) {
  const user = useAuthSession();
  const canManage = user.menuCodes.includes(managementGrant[side]);
  const [filters, setFilters] = useCoreSelection(side + ':' + source, {
    search: '', status: '', counterpartyId: initialParty, page: 1
  }, !!initialParty);
  const [search, setSearch] = useState(filters.search);
  const query = coreQuery({ ...filters, pageSize: 25 });
  const base = subledgerHref(side);
  const isDocument = source === 'documents';
  const title = isDocument ? subledgerName[side] : subledgerName[side] + ' · ' + settlementName[side] + 's';
  const documents = useCoreRead<AccountingPage<DocumentRow>>(sourcePath(side, source) + '?' + query, isDocument);
  const settlements = useCoreRead<AccountingPage<SettlementRow>>(sourcePath(side, source) + '?' + query, !isDocument);
  const read = isDocument ? documents : settlements;
  const onPageChange = (page: number) => setFilters({ ...filters, page });
  return <CorePage title={title} description={isDocument ? 'Review source documents, approval evidence and recognized balances.' : 'Review payments or receipts and their bank evidence.'}
    actions={<><Button variant="outline" disabled={read.loading} onClick={read.refresh}>Refresh</Button>
      {canManage ? <Link className="ui-button ui-button-primary" href={base + (isDocument ? '/new' : '/settlements/new')}>
        {isDocument ? (side === 'ap' ? 'New invoice' : 'New receivable') : 'New ' + settlementName[side].toLowerCase()}
      </Link> : null}</>}>
    <SubledgerLinks side={side} view={isDocument ? '' : '/settlements'} />
    <CoreCard>
      <form className={styles.toolbar} onSubmit={event => {
        event.preventDefault();
        setFilters({ ...filters, search: search.trim(), page: 1 });
      }}>
        <SearchInput aria-label={isDocument ? 'Document number' : 'Settlement reference'} placeholder={isDocument ? 'Document number' : 'Settlement reference'}
          maxLength={100} value={search} onChange={event => setSearch(event.target.value)} />
        <Select aria-label="Source status" value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value, page: 1 })}>
          <option value="">All statuses</option><option>DRAFT</option>
          <option>{isDocument ? 'RECOGNIZED' : 'POSTED'}</option><option>VOID</option>
        </Select>
        <Button type="submit" variant="outline">Search</Button>
      </form>
      <PartyChoice side={side} value={filters.counterpartyId} onChange={counterpartyId => setFilters({ ...filters, counterpartyId, page: 1 })} />
      <p className={styles.note}>{isDocument
        ? 'Sorted by accounting date, newest first. Open a document for its balances, allocation history and approvals. Use Outstanding or Aging for the as-of balance.'
        : 'Sorted by settlement date, newest first. Open a settlement for its allocations and linked bank evidence.'}</p>
      <CoreReadState read={read} />
      {documents.data && !documents.loading && !documents.error && isDocument ? <DataTable ariaLabel="AP/AR documents" rows={documents.data.rows}
        columns={documentColumns(base)} rowKey={row => row.id} minWidth="840px"
        pagination={{ ...documents.data, mode: 'server', onPageChange }} /> : null}
      {settlements.data && !settlements.loading && !settlements.error && !isDocument ? <DataTable ariaLabel="AP/AR settlements" rows={settlements.data.rows}
        columns={settlementColumns(base)} rowKey={row => row.id} minWidth="740px"
        pagination={{ ...settlements.data, mode: 'server', onPageChange }} /> : null}
    </CoreCard>
  </CorePage>;
}

const buckets = [
  ['current', 'Current'], ['days1To30', '1–30 days'], ['days31To60', '31–60 days'],
  ['days61To90', '61–90 days'], ['over90', 'Over 90 days']
] as const;

export function OutstandingWorkspace({ side, view, initialParty }: { side: Side; view: 'outstanding' | 'aging'; initialParty: string }) {
  const [scope, setScope] = useCoreSelection(side + ':' + view, { asOf: currentBusinessDayValue(), counterpartyId: initialParty, page: 1 }, !!initialParty);
  const validDate = validDay(scope.asOf);
  const read = useCoreRead<Outstanding>(side + '/' + view + '?' + coreQuery({ ...scope, pageSize: 25 }), validDate);
  const data = read.data;
  const columns: DataTableColumn<OutstandingRow>[] = [
    { key: 'documentNumber', header: 'Document', render: row => <Link className={styles.link} href={subledgerHref(side) + '/' + row.id}>{row.documentNumber}</Link> },
    { key: 'counterpartyId', header: 'Counterparty', render: row => <Link className={styles.link} href={'/accounting/counterparties?id=' + row.counterpartyId}>{row.counterpartyId}</Link> },
    { key: 'dueDate', header: 'Due date' },
    { key: 'originalAmount', header: 'Original', align: 'right', render: row => accountingMoney(row.originalAmount) },
    { key: 'adjustmentAmount', header: 'Adjustments', align: 'right', render: row => accountingMoney(row.adjustmentAmount) },
    { key: 'settledAmount', header: 'Settled', align: 'right', render: row => accountingMoney(row.settledAmount) },
    { key: 'outstanding', header: 'Outstanding', align: 'right', render: row => accountingMoney(row.outstanding) },
    { key: 'overdue', header: 'Days overdue', render: row => data ? Math.max(0, (Date.parse(data.asOf) - Date.parse(row.dueDate)) / 86400000) : '—' },
    { key: 'agingBucket', header: 'Aging bucket' }
  ];
  return <CorePage title={subledgerName[side] + (view === 'aging' ? ' · Aging' : ' · Outstanding')}
    description="As-of balances from recognized journals, adjustments, allocations and reversals."
    actions={<Button variant="outline" disabled={!validDate || read.loading} onClick={read.refresh}>Refresh balances</Button>}>
    <SubledgerLinks side={side} view={'/' + view} /><CorePolicyNote />
    <CoreCard>
      <CoreInput label="As-of date" type="date" value={scope.asOf} onChange={event => setScope({ ...scope, asOf: event.target.value, page: 1 })} />
      <PartyChoice side={side} value={scope.counterpartyId} onChange={counterpartyId => setScope({ ...scope, counterpartyId, page: 1 })} />
      {!validDate ? <p role="alert">Choose a valid as-of date.</p> : <CoreReadState read={read} />}
      {validDate && data && !read.loading && !read.error ? <>
        <h2>Outstanding as of {data.asOf}</h2>
        <strong>{accountingMoney(data.outstanding)}</strong>
        <p className={styles.note}>Total for the entire selected scope across all pages. The table includes documents with nonzero balances.</p>
        {data.negativeBalanceCount ? <p role="alert" className={styles.warning}>{data.negativeBalanceCount} negative balances require review.</p> : null}
        <dl className={styles.details}>{buckets.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{accountingMoney(data.aging[key])}</dd></div>)}</dl>
        <DataTable ariaLabel="Outstanding balances" rows={data.rows} columns={columns} rowKey={row => row.id} minWidth="960px"
          pagination={{ ...data, mode: 'server', onPageChange: page => setScope({ ...scope, page }) }} />
      </> : null}
    </CoreCard>
  </CorePage>;
}
