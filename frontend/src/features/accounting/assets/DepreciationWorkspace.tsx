'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import { CatalogChoice, ChoiceField, JournalLink, positiveAmount } from '../apar/fields';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { coreQuery } from '../core/api';
import { CoreCard, CoreFeedback, CoreInput, CorePage, CorePagination, CoreReadState, CoreTable } from '../core/CoreUI';
import { journalPermissions } from '../core/contracts.generated';
import { useFiscalYears } from '../core/FiscalScope';
import { useCoreMutation, useCoreRead } from '../core/hooks';
import { accountingMoney } from '../core/presentation';
import type { AccountingPage } from '../types';
import styles from '../core/core.module.css';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { createRun, previewRun } from './api';
import { assetHref, AssetLinks, dayOnly, JournalLines, runHref, snapshotMoney, SourceActions } from './AssetUI';
import type { AssetRow, RunDetail, RunPreview, RunRow } from './types';

export function DepreciationTable({ rows, label }: { rows: RunPreview['rows']; label: string }) {
  return <CoreTable label={label} headers={['Asset', 'Method / convention', 'Gross cost', 'Residual', 'Life', 'Accumulated', 'Impairment', 'Prospective basis', 'Planned depreciation']}>
    {rows.map(({ assetId, amount, snapshot }) => {
      const asset = snapshot.asset;
      return <tr key={assetId}><td><Link className={styles.link} href={assetHref + '/' + assetId}>{asset.code} · {asset.name}</Link></td>
        <td>STRAIGHT_LINE · {asset.policy?.partialMonthPolicy ?? 'Not supplied'}</td><td>{snapshotMoney(asset.cost)}</td>
        <td>{accountingMoney(asset.residual)}</td><td>{asset.life} months</td><td>{snapshotMoney(asset.accumulated)}</td>
        <td>{snapshotMoney(asset.impairment)}</td><td>{snapshotMoney(snapshot.prospectiveBasis)}</td>
        <td>{accountingMoney(amount)}{positiveAmount(amount) ? '' : ' · No positive depreciation'}</td></tr>;
    })}
  </CoreTable>;
}

function NewRun() {
  const fiscal = useFiscalYears(), router = useRouter(), mutation = useCoreMutation();
  const [reference, setReference] = useState(''), [periodId, setPeriodId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [candidate, setCandidate] = useState('');
  const [preview, setPreview] = useState<RunPreview | null>(null);
  const [issue, setIssue] = useState(''), [confirm, setConfirm] = useState(false);
  const periods = fiscal.data?.flatMap(year => year.revFkAccPeriodFy.map(period => {
    const from = new Date(dayOnly(period.startDate) + 'T00:00:00Z');
    const last = dayOnly(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)).toISOString());
    return { ...period, enabled: year.status === 'OPEN' && period.status === 'OPEN' && from.getUTCDate() === 1 && dayOnly(period.endDate) === last };
  })) ?? [];
  const input = { runReference: reference.trim(), accountingPeriodId: periodId, assetIds: selected };
  const error = !input.runReference ? 'Enter a run reference.'
    : !periods.some(row => row.id === periodId && row.enabled) ? 'Select a complete calendar-month OPEN period and fiscal year.'
      : !selected.length ? 'Select at least one active asset.' : '';
  async function generate() {
    setIssue(error);
    if (error) return;
    setPreview(null);
    const result = await mutation.run(() => previewRun(input), 'Backend preview ready. No run was saved.');
    if (result) setPreview(result);
  }
  async function save() {
    if (!preview || !preview.rows.some(row => positiveAmount(row.amount)) || error) return;
    const result = await mutation.run(() => createRun(input), 'Depreciation run draft saved.');
    setConfirm(false);
    if (result) router.push(runHref + '/' + result.id);
  }
  return <><CoreReadState read={fiscal} /><CoreFeedback error={issue || mutation.error} message={mutation.message} />
    <fieldset className={styles.page} disabled={mutation.busy || confirm}>
      <div className={styles.formGrid}>
        <CoreInput label="Run reference" value={reference} maxLength={100} onChange={event => { setReference(event.target.value); setPreview(null); }} />
        <ChoiceField label="Depreciation period" value={periodId} onChange={id => { setPeriodId(id); setPreview(null); }}
          choices={periods.map(period => ({ id: period.id, label: period.periodCode + ' · ' + period.status, disabled: !period.enabled }))} />
      </div>
      <CatalogChoice<AssetRow> path="assets" label="Asset to include" value={candidate} onChange={setCandidate}
        choice={row => ({ id: row.id, label: row.assetNumber + ' · ' + row.assetName + ' · ' + row.status, disabled: row.status !== 'ACTIVE' || selected.includes(row.id) })} />
      <div><Button variant="outline" disabled={!candidate || selected.includes(candidate) || selected.length >= 200} onClick={() => {
        setSelected([...selected, candidate]); setCandidate(''); setPreview(null);
      }}>Include asset</Button></div>
      <p className={styles.note}>{selected.length} / 200 distinct assets selected. Preview uses the backend eligibility checks and creates no journal or reservation.</p>
      {selected.length ? <CoreTable label="Selected assets" headers={['Asset ID', 'Selection']}>{selected.map(id =>
        <tr key={id}><td><Link className={styles.link} href={assetHref + '/' + id}>{id}</Link></td><td><Button variant="outline"
          onClick={() => { setSelected(selected.filter(value => value !== id)); setPreview(null); }}>Remove asset</Button></td></tr>)}</CoreTable> : null}
      <div><Button variant="outline" onClick={generate}>Preview depreciation</Button></div>
      {preview ? <>
        <h2>Backend depreciation preview · {preview.period.periodCode}</h2>
        <p className={styles.note}>Planned values only. The prospective basis is the backend snapshot basis for the current estimate. The API does not return a separate remaining depreciable amount.</p>
        <DepreciationTable rows={preview.rows} label="Depreciation preview allocations" />
        <div><Button disabled={!preview.rows.some(row => positiveAmount(row.amount))} onClick={() => setConfirm(true)}>Create depreciation run</Button></div>
      </> : null}
    </fieldset>
    <ConfirmDialog open={confirm} title="Reserve depreciation run?" message="Save a draft and reserve due positive asset/period rows. Approval and posting are separate actions."
      confirmLabel="Save depreciation run" loading={mutation.busy} onCancel={() => setConfirm(false)} onConfirm={save} />
  </>;
}

function RunList() {
  const [input, setInput] = useState(''), [scope, setScope] = useState({ search: '', status: '', page: 1 });
  const read = useCoreRead<AccountingPage<RunRow>>('depreciation-runs?' + coreQuery({ ...scope, pageSize: 25 }));
  return <><form className={styles.toolbar} onSubmit={event => { event.preventDefault(); setScope({ ...scope, search: input.trim(), page: 1 }); }}>
    <CoreInput label="Search run reference" value={input} maxLength={100} onChange={event => setInput(event.target.value)} />
    <Button type="submit" variant="outline">Search runs</Button>
    <ChoiceField label="Run status" value={scope.status} onChange={status => setScope({ ...scope, status, page: 1 })} empty="All statuses"
      choices={['DRAFT', 'POSTED', 'VOID'].map(id => ({ id, label: id }))} />
    <Button variant="outline" disabled={read.loading} onClick={read.refresh}>Refresh runs</Button>
  </form><CoreReadState read={read} empty={read.data?.rows.length === 0} />
    {read.data && !read.loading && !read.error ? <>
      <CoreTable label="Depreciation runs" headers={['Run', 'Run date', 'Status', 'Journal']}>
        {read.data.rows.map(row => <tr key={row.id}><td><Link className={styles.link} href={runHref + '/' + row.id}>{row.runReference}</Link></td>
          <td>{dayOnly(row.runDate)}</td><td><AccountingStatusIndicator status={row.status} /></td><td><JournalLink id={row.postingJournalId} /></td></tr>)}
      </CoreTable><CorePagination {...read.data} loading={read.loading} onPage={page => setScope({ ...scope, page })} />
    </> : null}
  </>;
}

function RunView({ id }: { id: string }) {
  const read = useCoreRead<RunDetail>('depreciation-runs/' + id);
  const run = read.data;
  return <><CoreReadState read={read} />
    {run && !read.error ? <>
      {!read.loading ? <>
        <div className={styles.actions}><h2>{run.runReference}</h2><AccountingStatusIndicator status={run.status} /><Button variant="outline" onClick={read.refresh}>Refresh run</Button></div>
        <p>Accounting period · {run.relFkAccDepRunPeriod.periodCode} · {dayOnly(run.runDate)} · Revision {run.revision}</p>
        <p className={styles.note}>Retained planned amounts and snapshots. A posted journal provides the financial result.</p>
        <DepreciationTable label="Depreciation run evidence" rows={run.revFkAccDepRunAssetRun.map(row => ({
          assetId: row.fixedAssetId, amount: row.plannedAmount, snapshot: row.assetSnapshot,
        }))} />
        {run.relFkAccDepRunJournal ? <>
          <JournalLines label="Posted depreciation journal" journal={run.relFkAccDepRunJournal} />
          <CoreTable label="Posted depreciation line mapping" headers={['Asset', 'Expense line ID', 'Accumulated line ID']}>
            {run.revFkAccDepRunAssetRun.map(row => <tr key={row.id}><td>{row.assetSnapshot.asset.code}</td>
              <td>{row.expenseJournalLineId ?? 'Not supplied'}</td><td>{row.accumulatedJournalLineId ?? 'Not supplied'}</td></tr>)}
          </CoreTable>
        </> : null}
        <p className={styles.note}>Use the returned approval link or the Accounting Approval queue for review history. Run detail does not return a source-scoped approval list.</p>
      </> : null}
    </> : null}
    <SourceActions path="depreciation-runs" source={!read.loading && !read.error ? run : null}
      date={dayOnly(run?.runDate)} onChanged={read.refresh} />
  </>;
}

export function DepreciationWorkspace({ create, id }: { create?: boolean; id?: string }) {
  const user = useAuthSession(), manage = user.menuCodes.includes(journalPermissions.manage);
  return <CorePage title={create ? 'New depreciation run' : id ? 'Depreciation run detail' : 'Depreciation runs'}
    description="Explicit period selection, backend preview and independently approved posting."
    actions={!create && !id && manage ? <Link className={styles.link} href={runHref + '/new'}>New depreciation run</Link> : undefined}>
    <AssetLinks /><CoreCard>{create ? manage ? <NewRun /> : <p role="alert">Journal management permission is required.</p>
      : id ? <RunView id={id} /> : <RunList />}</CoreCard>
  </CorePage>;
}
