'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import { ChoiceField, JournalLink } from '../apar/fields';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { coreQuery } from '../core/api';
import { CoreCard, CoreFeedback, CoreInput, CorePage, CorePagination, CorePolicyNote, CoreReadState, CoreTable } from '../core/CoreUI';
import { journalPermissions } from '../core/contracts.generated';
import { useCoreRead } from '../core/hooks';
import { accountingMoney, decimalCents } from '../core/presentation';
import type { AccountingPage } from '../types';
import styles from '../core/core.module.css';
import { SourceHistory } from '../schedules/ScheduleUI';
import { AssetForm } from './AssetForm';
import { assetHref, AssetLinks, categoryHref, CategoryChoice, changeHref, dayOnly, JournalLines, runHref, SourceActions } from './AssetUI';
import { CategoryEvidence } from './CategoryWorkspace';
import { ChangeForm, changeLabel } from './ChangeWorkspace';
import type { AssetDetail, AssetJournal, AssetReconciliation, AssetRow } from './types';

const assetStates = ['DRAFT', 'ACTIVE', 'CANCELLED', 'DISPOSED', 'WRITTEN_OFF'];
function Register() {
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState({ search: '', categoryId: '', status: '', page: 1 });
  const [sort, setSort] = useState('');
  const read = useCoreRead<AccountingPage<AssetRow>>('assets?' + coreQuery({ ...scope, pageSize: 25 }));
  const rows = read.data?.rows ?? [];
  const sorted = sort ? [...rows].sort((left, right) => sort === 'NAME'
    ? left.assetName.localeCompare(right.assetName) : right.acquiredOn.localeCompare(left.acquiredOn)) : rows;
  return <>
    <form className={styles.toolbar} onSubmit={event => { event.preventDefault(); setScope({ ...scope, search: search.trim(), page: 1 }); }}>
      <CoreInput label="Search asset code or name" value={search} maxLength={100} onChange={event => setSearch(event.target.value)} />
      <Button type="submit" variant="outline">Search assets</Button>
      <Button variant="outline" disabled={read.loading} onClick={read.refresh}>Refresh assets</Button>
    </form>
    <div className={styles.formGrid}>
      <CategoryChoice value={scope.categoryId} onChange={categoryId => setScope({ ...scope, categoryId, page: 1 })} includeInactive />
      <ChoiceField label="Asset status" value={scope.status} onChange={status => setScope({ ...scope, status, page: 1 })}
        empty="All statuses" choices={assetStates.map(id => ({ id, label: id }))} />
      <ChoiceField label="Sort current page" value={sort} onChange={setSort} empty="Asset code (server order)"
        choices={[{ id: 'NAME', label: 'Asset name' }, { id: 'RECENT', label: 'Newest acquisition' }]} />
    </div>
    <p className={styles.note}>Search and filters apply across the register. Additional sort options reorder this page. Open an asset for posted balances and depreciation history.</p>
    <CoreReadState read={read} empty={rows.length === 0} />
    {read.data && !read.loading && !read.error ? <>
      <CoreTable label="Fixed asset register" headers={['Code / name', 'Category', 'Acquired / available for use', 'Acquisition cost', 'Residual', 'Life / method', 'Location', 'Status']}>
        {sorted.map(row => <tr key={row.id}>
          <td><Link className={styles.link} href={assetHref + '/' + row.id}>{row.assetNumber} · {row.assetName}</Link></td>
          <td><Link className={styles.link} href={categoryHref + '/' + row.assetCategoryId}>Category mapping</Link></td>
          <td>{dayOnly(row.acquiredOn)} / {dayOnly(row.inServiceOn)}</td><td>{accountingMoney(row.acquisitionCost)}</td><td>{accountingMoney(row.residualValue)}</td>
          <td>{row.usefulLifeMonths} mo · {row.depreciationMethod}</td><td>{row.location ?? '—'}</td><td><AccountingStatusIndicator status={row.status} /></td>
        </tr>)}
      </CoreTable>
      <CorePagination {...read.data} loading={read.loading} onPage={page => setScope({ ...scope, page })} />
    </> : null}
  </>;
}

function JournalHistory({ id }: { id: string }) {
  const read = useCoreRead<{ limit: number; rows: AssetJournal[] }>('assets/' + id + '/journals');
  return <><CoreReadState read={read} empty={read.data?.rows.length === 0} />
    {read.data && !read.loading && !read.error ? <>
      <p className={styles.note}>Backend journal history limit · {read.data.limit}</p>
      <CoreTable label="Asset journal history" headers={['Journal', 'Date', 'Type', 'Original / link']}>{read.data.rows.map(row =>
        <tr key={row.id}><td>{row.journalNumber}</td><td>{dayOnly(row.accountingDate)}</td><td>{row.journalType}</td>
          <td><JournalLink id={row.id} /> {row.reversalOfJournalId ? <>· Reverses <JournalLink id={row.reversalOfJournalId} /></> : null}</td></tr>)}
      </CoreTable>
    </> : null}
  </>;
}

function AssetEvidence({ asset }: { asset: AssetDetail }) {
  const source = asset.relFkAccFixedAssetSource, category = asset.relFkAccFixedAssetCat;
  const history = asset.revFkAccDepRunAssetAsset;
  const lastDate = history.reduce((date, row) => {
    const journal = row.relFkAccDepRunAssetRun.relFkAccDepRunJournal;
    if (!journal || journal.revFkAccJournalReversal) return date;
    const day = dayOnly(journal.accountingDate);
    return day > date ? day : date;
  }, '');
  const disposal = asset.relFkAccFixedAssetDisposal;
  const gainLoss = disposal?.lines.filter(line => line.accountId === category.gainAccountId && (decimalCents(line.credit) ?? BigInt(0)) > BigInt(0)
    || line.accountId === category.lossAccountId && (decimalCents(line.debit) ?? BigInt(0)) > BigInt(0)) ?? [];
  return <>
    <dl className={styles.details}>
      <dt>Description / location</dt><dd>{asset.description ?? 'Not supplied'} · {asset.location ?? 'Not supplied'}</dd>
      <dt>Custodian user ID</dt><dd>{asset.custodianId ?? 'Not supplied'}</dd>
      <dt>Category</dt><dd><Link className={styles.link} href={categoryHref + '/' + category.id}>{category.categoryCode} · {category.categoryName}</Link></dd>
      <dt>Acquired / available for use</dt><dd>{dayOnly(asset.acquiredOn)} / {dayOnly(asset.inServiceOn)}</dd>
      <dt>Start / life / method</dt><dd>{dayOnly(asset.depreciationStartOn)} · {asset.usefulLifeMonths} months · {asset.depreciationMethod}</dd>
      <dt>Acquisition cost</dt><dd>{accountingMoney(source.debit)}</dd><dt>Gross cost</dt><dd>{accountingMoney(asset.grossCost)}</dd>
      <dt>Residual value</dt><dd>{accountingMoney(asset.residualValue)}</dd>
      <dt>Accumulated depreciation</dt><dd>{accountingMoney(asset.accumulatedDepreciation)}</dd>
      <dt>Impairment</dt><dd>{accountingMoney(asset.impairment)}</dd><dt>Net book value</dt><dd>{accountingMoney(asset.carryingAmount)}</dd>
      <dt>Last unreversed depreciation</dt><dd>{lastDate || 'No posted depreciation returned'}</dd>
      <dt>Depreciation state</dt><dd><AccountingStatusIndicator status={asset.depreciationState} /></dd>
      <dt>Acquisition journal / line</dt><dd>{source.journal.journalNumber} · <JournalLink id={source.journalId} /> · {source.id}
        {source.journal.revFkAccJournalReversal ? <> · Reversed <JournalLink id={source.journal.revFkAccJournalReversal.id} /></> : null}</dd>
      <dt>AP acquisition</dt><dd>{asset.sourceDocumentId ? <Link className={styles.link} href={'/accounting/payables/' + asset.sourceDocumentId}>View AP invoice</Link> : 'No AP source returned'}</dd>
      <dt>Acquisition evidence</dt><dd>{asset.policySnapshot?.supportingEvidence ?? 'Not supplied'}</dd>
      <dt>Applied policy snapshot</dt><dd>{asset.policySnapshot?.policyReference ?? 'Not supplied'} · {asset.policySnapshot?.partialMonthPolicy ?? 'No convention supplied'}</dd>
      <dt>Revision / updated by</dt><dd>{asset.revision} · {asset.updatedAt} · {asset.updatedById}</dd>
      <dt>Created by</dt><dd>{asset.createdAt} · {asset.createdById}</dd>
    </dl>
    <h2>Category and COA mappings</h2><CategoryEvidence category={category} />
    <h2>Acquisition payments</h2>
    {asset.payments.length ? <CoreTable label="Acquisition payment allocations" headers={['Settlement', 'Allocation', 'Status', 'Journal']}>
      {asset.payments.map(row => {
        const settlement = row.relFkAccAllocationSettlement;
        return <tr key={row.id}><td><Link className={styles.link} href={'/accounting/payables/settlements/' + settlement.id}>{settlement.settlementReference}</Link></td>
          <td>{accountingMoney(row.allocatedAmount)}</td><td>{settlement.status}</td><td><JournalLink id={settlement.postingJournalId} /></td></tr>;
      })}
    </CoreTable> : <p className={styles.note}>No acquisition payment allocations returned.</p>}
    <h2>Depreciation history</h2>
    {history.length ? <CoreTable label="Asset depreciation history" headers={['Run / period', 'Planned amount', 'Actual accumulated credit', 'Run state', 'Journal']}>
      {history.map(row => {
        const run = row.relFkAccDepRunAssetRun, journal = run.relFkAccDepRunJournal;
        return <tr key={row.id}><td><Link className={styles.link} href={runHref + '/' + run.id}>{run.runReference}</Link> · {run.relFkAccDepRunPeriod.periodCode}</td>
          <td>{accountingMoney(row.plannedAmount)}</td><td>{accountingMoney(row.relFkAccDepRunAssetAccum?.credit)}</td>
          <td>{run.status}</td><td><JournalLink id={run.postingJournalId} />{journal?.revFkAccJournalReversal ? <> · Reversed <JournalLink id={journal.revFkAccJournalReversal.id} /></> : null}</td></tr>;
      })}
    </CoreTable> : <p className={styles.note}>No depreciation runs returned.</p>}
    <h2>Adjustments, impairment and disposal</h2>
    {asset.changes.length ? <CoreTable label="Asset lifecycle changes" headers={['Action', 'Date / reason', 'Status', 'Journal']}>
      {asset.changes.map(row => <tr key={row.id}><td><Link className={styles.link} href={changeHref + '/' + row.id}>{changeLabel(row.assetMetadata.action)}</Link></td>
        <td className={styles.wrap}>{dayOnly(row.accountingDate)} · {row.assetMetadata.reason}</td>
        <td>{row.status}</td><td><JournalLink id={row.postedJournalId} /></td></tr>)}
    </CoreTable> : <p className={styles.note}>No lifecycle changes returned.</p>}
    {disposal ? <><h3>Posted disposal · {dayOnly(asset.disposedOn)}</h3>
      {gainLoss.map(line => <p key={line.id}>{line.accountId === category.gainAccountId ? 'Posted disposal gain' : 'Posted disposal loss'} · {accountingMoney(line.accountId === category.gainAccountId ? line.credit : line.debit)}</p>)}
      <JournalLines journal={disposal} label="Posted disposal journal" /></> : null}
    <SourceHistory approvals={asset.approvalHistory} limit={asset.relatedLimit} />
  </>;
}

function Detail({ id }: { id: string }) {
  const user = useAuthSession(), read = useCoreRead<AssetDetail>('assets/' + id);
  const [edit, setEdit] = useState(false), [newChange, setNewChange] = useState(false), [journals, setJournals] = useState(false);
  const [message, setMessage] = useState(''), [pending, setPending] = useState<{ id: string; reason?: string } | null>(null);
  const asset = read.data, manage = user.menuCodes.includes(journalPermissions.manage);
  const canEdit = !!asset && manage && asset.createdById === user.id && ['DRAFT', 'CANCELLED'].includes(asset.status);
  return <><CoreReadState read={read} /><CoreFeedback error="" message={message} />
    {pending ? <p className={styles.warning}>{pending.reason ?? 'Lifecycle draft saved.'} · <Link className={styles.link} href={changeHref + '/' + pending.id}>Open change draft</Link></p> : null}
    {asset && !read.error ? <>
      {!read.loading ? <>
        <div className={styles.actions}><h2>{asset.assetNumber} · {asset.assetName}</h2><AccountingStatusIndicator status={asset.status} />
          <AccountingStatusIndicator status={asset.policyStatus} /><Button variant="outline" onClick={read.refresh}>Refresh asset</Button></div>
        <p className={styles.warning}>Valuation-based impairment reversal remains PENDING_POLICY.</p>
        <div className={styles.actions}>
          {canEdit ? <Button variant="outline" onClick={() => setEdit(!edit)}>{edit ? 'Close draft editor' : 'Edit asset draft'}</Button> : null}
          {manage && asset.status === 'ACTIVE' ? <Button onClick={() => setNewChange(true)}>New lifecycle draft</Button> : null}
          <Button variant="outline" onClick={() => setJournals(!journals)}>{journals ? 'Hide journal history' : 'Load journal history'}</Button>
        </div>
        {edit && canEdit ? <AssetForm key={asset.revision} asset={asset} onSaved={() => { setMessage('Asset draft revised.'); setEdit(false); read.refresh(); }} /> : null}
      </> : null}
      {newChange ? <ChangeForm asset={asset} onClose={() => setNewChange(false)} onSaved={draft => {
        setNewChange(false); setPending({ id: draft.id, reason: draft.policyReason }); read.refresh();
      }} /> : null}
    </> : null}
    <SourceActions path="assets" source={!read.loading && !read.error ? asset : null}
      date={dayOnly(asset?.relFkAccFixedAssetSource.journal.accountingDate)} approvals={asset?.approvalHistory}
      block={asset?.policyStatus === 'PENDING_POLICY' ? 'PENDING_POLICY · Adopted capitalization and depreciation policy is required for activation.' : ''}
      onChanged={read.refresh} />
    {asset && !read.loading && !read.error ? <>{journals ? <JournalHistory id={id} /> : null}<AssetEvidence asset={asset} /></> : null}
  </>;
}

export function AssetWorkspace({ id, create, journalId }: { id?: string; create?: boolean; journalId?: string }) {
  const user = useAuthSession(), router = useRouter();
  const manage = user.menuCodes.includes(journalPermissions.manage);
  return <CorePage title={create ? 'New fixed asset' : id ? 'Fixed asset detail' : 'Fixed asset register'}
    description="Source-backed acquisition, depreciation and lifecycle evidence."
    actions={!id && !create && manage ? <Link className={styles.link} href={assetHref + '/new'}>New fixed asset</Link> : undefined}>
    <AssetLinks /><CorePolicyNote /><CoreCard>{create
      ? manage ? <AssetForm journalId={journalId} onSaved={value => router.push(assetHref + '/' + value)} /> : <p role="alert">Journal management permission is required.</p>
      : id ? <Detail id={id} /> : <Register />}</CoreCard>
  </CorePage>;
}

export function ReconciliationWorkspace() {
  const read = useCoreRead<AssetReconciliation>('assets/reconciliation');
  const data = read.data;
  return <CorePage title="Asset–GL reconciliation" description="Read-only comparison of the register and mapped General Ledger balances.">
    <AssetLinks /><CoreCard><div><Button variant="outline" disabled={read.loading} onClick={read.refresh}>Refresh reconciliation</Button></div>
      <p className={styles.note}>Scope · Current full-register comparison. The endpoint has no fiscal-period or as-of filter.</p>
      <CoreReadState read={read} empty={data?.rows.length === 0} />
      {data && !read.loading && !read.error ? <>
        <p>{data.basis}</p>
        <p><AccountingStatusIndicator status={!data.rows.length ? 'UNVERIFIED' : data.reconciled ? 'RECONCILED' : 'MISMATCH'} /></p>
        {!data.rows.length ? <p className={styles.note}>No mapped control rows were returned for comparison.</p> : <CoreTable label="Asset control reconciliation" headers={['Role', 'Mapped GL account', 'Register', 'General Ledger', 'Difference', 'Comparison']}>
          {data.rows.map(row => <tr key={row.role + ':' + row.accountId}><td>{row.role}</td>
            <td><Link className={styles.link} href={'/accounting/general-ledger?accountId=' + row.accountId}>{row.accountId}</Link></td>
            <td>{accountingMoney(row.register)}</td><td>{accountingMoney(row.generalLedger)}</td><td>{accountingMoney(row.variance)}</td>
            <td>{row.reconciled ? 'Matched' : 'Mismatch'}</td></tr>)}
        </CoreTable>}
      </> : null}
    </CoreCard>
  </CorePage>;
}
