'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import { Button } from '@/components/ui/Button';
import { ApprovalLink, CatalogChoice, ChoiceField, JournalLink, TextArea, validDay } from '../apar/fields';
import { CoreFeedback, CoreInput, CoreReadState, CoreTable } from '../core/CoreUI';
import { openDateReason, useFiscalYears } from '../core/FiscalScope';
import { useCoreRead } from '../core/hooks';
import { journalPermissions } from '../core/contracts.generated';
import { accountingMoney, centsDecimal, decimalCents } from '../core/presentation';
import { routeId } from '../core/route-scope';
import type { CoreJournal } from '../core/types';
import styles from '../core/core.module.css';
import { ActionReview } from '../schedules/ScheduleUI';
import { cancelAssetSource, refreshAssetSource, submitAssetSource } from './api';
import type { ApprovalAction, AssetJournal, Category, DraftSource, SourcePath } from './types';

export const assetHref = '/accounting/assets';
export const runHref = assetHref + '/depreciation';
export const categoryHref = assetHref + '/categories';
export const changeHref = assetHref + '/changes';
export const dayOnly = (value?: string | null) => value?.slice(0, 10) ?? '';
export const moneyInput = (value: string) => /^\d{1,18}(\.\d{1,2})?$/.test(value);
export const validLife = (value: string) => /^\d{1,3}$/.test(value) && Number(value) >= 1 && Number(value) <= 600;
export const snapshotMoney = (value: unknown) => typeof value === 'string' && /^-?\d{1,24}$/.test(value)
  ? accountingMoney(centsDecimal(BigInt(value))) : 'Not supplied';

export function AssetLinks() {
  return <nav className={styles.toolbar} aria-label="Fixed asset views">
    {[[assetHref, 'Asset register'], [categoryHref, 'Asset categories'], [runHref, 'Depreciation runs'], [assetHref + '/reconciliation', 'Asset–GL reconciliation']].map(([href, label]) =>
      <Link className={styles.link} key={href} href={href}>{label}</Link>)}
  </nav>;
}

export function CategoryChoice({ value, onChange, includeInactive = false, exclude }: {
  value: string; onChange: (id: string) => void; includeInactive?: boolean; exclude?: string;
}) {
  return <CatalogChoice<Category> path="asset-categories" label="Asset category" value={value} onChange={onChange}
    empty={includeInactive ? 'All categories' : 'Select a category'} choice={row => ({
      id: row.id, label: row.categoryCode + ' · ' + row.categoryName + (row.activeFlag ? '' : ' (inactive)'),
      disabled: (!includeInactive && !row.activeFlag) || row.id === exclude,
    })} />;
}

export function PostedLineChoice({ value, onChange, label, initialJournal = '', eligible }: {
  value: string; onChange: (id: string, line?: CoreJournal['lines'][number]) => void; label: string; initialJournal?: string;
  eligible: (line: CoreJournal['lines'][number], journal: CoreJournal) => boolean;
}) {
  const [input, setInput] = useState(initialJournal), [id, setId] = useState(initialJournal);
  const read = useCoreRead<CoreJournal>('journals/' + id, !!id);
  const journal = !read.loading && !read.error ? read.data : null;
  const lines = journal?.state === 'POSTED' && !journal.reversalOfJournalId && !journal.linkedJournals.some(row => row.journalType === 'REVERSAL')
    ? journal.lines.filter(row => eligible(row, journal)) : [];
  return <div className={styles.page}>
    <div className={styles.toolbar}>
      <CoreInput label={label + ' journal ID'} value={input} onChange={event => {
        setInput(event.target.value); setId(''); onChange('');
      }} />
      <Button variant="outline" disabled={!routeId(input) || read.loading} onClick={() => setId(routeId(input))}>Load {label.toLowerCase()} journal</Button>
    </div>
    {id ? <CoreReadState read={read} /> : null}
    {journal ? <p className={styles.note}>{journal.journalNumber} · <JournalLink id={journal.id} /> <SourceDocumentLink journal={journal} />
      {lines.length ? '' : ' · No eligible posted source lines for this mapping.'}</p> : null}
    <ChoiceField label={label + ' line'} value={value} onChange={lineId => onChange(lineId, lines.find(row => row.id === lineId))}
      choices={lines.map(row => ({ id: row.id, label: row.accountCodeSnapshot + ' · ' + row.accountNameSnapshot + ' · debit ' + accountingMoney(row.debit) + ' / credit ' + accountingMoney(row.credit) }))} />
  </div>;
}

export const isDebit = (line: CoreJournal['lines'][number]) => (decimalCents(line.debit) ?? BigInt(0)) > BigInt(0) && decimalCents(line.credit) === BigInt(0);
export const isCredit = (line: CoreJournal['lines'][number]) => (decimalCents(line.credit) ?? BigInt(0)) > BigInt(0) && decimalCents(line.debit) === BigInt(0);
export const purchaseKind = (journal: CoreJournal) => ['AP_DOCUMENT', 'MANUAL_JOURNAL'].includes(journal.sourceKind);

export function SourceDocumentLink({ journal }: { journal: Pick<CoreJournal, 'sourceKind' | 'sourceReference'> }) {
  const id = routeId(journal.sourceReference ?? '');
  if (!id || !['AR_DOCUMENT', 'AP_DOCUMENT'].includes(journal.sourceKind)) return null;
  const receivable = journal.sourceKind === 'AR_DOCUMENT';
  return <Link className={styles.link} href={'/accounting/' + (receivable ? 'receivables' : 'payables') + '/' + id}>
    {receivable ? 'View AR evidence document' : 'View AP evidence document'}
  </Link>;
}

export function JournalLines({ journal, label }: { journal: AssetJournal; label: string }) {
  return <><p>{journal.journalNumber} · {dayOnly(journal.accountingDate)} · <JournalLink id={journal.id} />
    {journal.revFkAccJournalReversal ? <> · Reversal <JournalLink id={journal.revFkAccJournalReversal.id} /></> : null}</p>
    <CoreTable label={label} headers={['Account', 'Debit', 'Credit']}>
      {journal.lines.map(line => <tr key={line.id}><td>{line.accountCodeSnapshot} · {line.accountNameSnapshot}</td>
        <td>{accountingMoney(line.debit)}</td><td>{accountingMoney(line.credit)}</td></tr>)}
    </CoreTable></>;
}

export function SourceActions({ path, source, date, approvals = [], block = '', onChanged }: {
  path: SourcePath; source?: DraftSource | null; date: string; approvals?: ApprovalAction[]; block?: string; onChanged: () => void;
}) {
  const user = useAuthSession(), fiscal = useFiscalYears();
  const [action, setAction] = useState<'submit' | 'refresh' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const [last, setLast] = useState<{ message: string; request?: ApprovalAction } | null>(null);
  const retained = approvals.find(item => item.sourceDocumentId === source?.id && item.sourceVersion === source.revision);
  const request = retained ?? (last?.request && (!source || last.request.sourceVersion === source.revision) ? last.request : undefined);
  const awaitingDecision = request && ['PENDING', 'APPROVED'].includes(request.status);
  const owningDraft = user.id === source?.createdById && user.menuCodes.includes(journalPermissions.manage) && source.status === 'DRAFT';
  async function run() {
    if (!source) throw new Error('Refresh the current asset source.');
    if (action === 'submit') return { message: 'Independent approval requested.', request: await submitAssetSource(path, source) };
    if (action === 'refresh' && path !== 'assets') { await refreshAssetSource(path, source); return { message: 'Draft refreshed. Review and submit the new version.' }; }
    await cancelAssetSource(path, source, reason.trim());
    return { message: 'Draft withdrawn by backend.' };
  }
  const label = action === 'submit' ? 'Submit for independent approval' : action === 'refresh' ? 'Refresh draft evidence' : 'Withdraw draft';
  return <>
    <CoreFeedback error="" message={last?.message ?? ''} />
    {request ? <ApprovalLink id={request.id}>{request.status} · Open approval</ApprovalLink> : null}
    {owningDraft ? <><div className={styles.actions}>
      {!awaitingDecision ? <Button disabled={!!block} onClick={() => setAction('submit')}>Submit for approval</Button> : null}
      {path !== 'assets' ? <Button variant="outline" onClick={() => setAction('refresh')}>Refresh draft evidence</Button> : null}
      <Button variant="outline" onClick={() => setAction('cancel')}>Withdraw draft</Button>
    </div>{block ? <p className={styles.warning}>{block}</p> : null}</> : null}
    {action && owningDraft ? <ActionReview title={label} description="The backend checks the current revision and records the result."
      fields={action === 'cancel' ? <TextArea label="Withdrawal reason" value={reason} onChange={setReason} maxLength={1000} />
        : action === 'submit' ? <><p>Accounting date · {date}</p><CoreReadState read={fiscal} /></> : null}
      validate={() => action === 'cancel' ? (!reason.trim() ? 'Enter a withdrawal reason.' : '') : action === 'submit'
        ? block || (!validDay(date) ? 'Accounting date is unavailable.' : openDateReason(fiscal.data, date)) : ''}
      run={run} onClose={() => setAction(null)} onDone={result => { setLast(result); setAction(null); setReason(''); onChanged(); }} /> : null}
  </>;
}
