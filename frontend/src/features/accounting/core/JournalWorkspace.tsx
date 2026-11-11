"use client";
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import { currentBusinessDayValue, currentBusinessMonthValue } from '@/lib/business-time';
import type { AccountingPage, AccountingReport } from '../types';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { coreQuery, requestApproval } from './api';
import { useCoreMutation, useCoreRead, useCoreSelection } from './hooks';
import { CoreCard, CoreFeedback, CoreInput, CorePage, CorePagination, CorePolicyNote, CoreReadState, CoreTable } from './CoreUI';
import { FiscalScope, openDateReason, useFiscalYears } from './FiscalScope';
import { DraftForm } from './DraftForm';
import { journalPermissions } from './contracts.generated';
import { accountingMoney, centsDecimal, decimalCents, text } from './presentation';
import type { CoreJournal, Draft, DraftHeader } from './types';
import styles from './core.module.css';

export function JournalDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const read = useCoreRead<CoreJournal>(`journals/${id}`), user = useAuthSession(), mutation = useCoreMutation(), fiscal = useFiscalYears();
  const [reversalDate, setReversalDate] = useState(currentBusinessDayValue()), [remark, setRemark] = useState(''), [confirm, setConfirm] = useState(false), [approvalId, setApprovalId] = useState('');
  const journal = read.data;
  const mayReverseCore = journal && user.menuCodes.includes(journalPermissions.manage)
    && ['MANUAL_JOURNAL', 'ADJUSTING_JOURNAL', 'FINALIZED_BANK_TRANSACTION', 'CORRECTION_RECLASSIFICATION'].includes(journal.sourceKind);
  const mayReverseAdjustment = journal?.sourceKind === 'AR_ADJUSTMENT' && user.menuCodes.includes('ACCOUNTING_AR_MANAGE')
    && !journal.linkedJournals.some(related => related.journalType === 'REVERSAL');
  const mayReverseSourceJournal = journal && user.menuCodes.includes(journalPermissions.manage)
    && ['ACCRUAL_ADJUSTMENT', 'SCHEDULE_RECOGNITION', 'SCHEDULE_TERMINATION', 'ASSET_JOURNAL', 'DEPRECIATION_RUN',
      'FUND_CLASSIFY', 'FUND_OPENING', 'FUND_RESTRICTION', 'FUND_RELEASE'].includes(journal.sourceKind)
    && !journal.linkedJournals.some(related => related.journalType === 'REVERSAL');
  const mayReverse = journal?.journalType !== 'REVERSAL' && (mayReverseCore || mayReverseAdjustment || mayReverseSourceJournal);
  const periodReason = openDateReason(fiscal.data, reversalDate);
  const total = journal?.lines.reduce((sum, line) => ({ debit: sum.debit + (decimalCents(line.debit) ?? BigInt(0)), credit: sum.credit + (decimalCents(line.credit) ?? BigInt(0)) }), { debit: BigInt(0), credit: BigInt(0) });
  async function submitReversal() {
    const result = await mutation.run(() => requestApproval({ kind: 'JOURNAL_REVERSAL', sourceDocumentId: id, accountingDate: reversalDate, remark: remark.trim() }), 'Reversal approval requested. Original journal retained.');
    if (result) { setConfirm(false); setApprovalId(result.id); }
  }
  return <><Modal open title={journal?.journalNumber ?? 'Journal detail'} description="Immutable posted journal evidence. No edit or delete action is available." onClose={() => { if (!mutation.busy) onClose(); }}><div className={styles.modal}><CoreReadState read={read} /><CoreReadState read={fiscal} /><CoreFeedback {...mutation} />
    {journal && !read.loading && !read.error ? <><AccountingStatusIndicator status={journal.state} /><dl className={styles.details}><dt>Accounting date</dt><dd>{journal.accountingDate.slice(0, 10)}</dd><dt>Period ID</dt><dd>{journal.accountingPeriodId ?? 'Not supplied'}</dd><dt>Source type</dt><dd>{journal.sourceKind}</dd><dt>Source document reference</dt><dd>{journal.sourceReference ?? 'Not supplied'}</dd><dt>Description</dt><dd>{journal.descriptionSnapshot ?? 'Not supplied'}</dd><dt>Posted by / at</dt><dd>{journal.postedById ?? 'Not supplied'} · {journal.postedAt}</dd><dt>Created by</dt><dd>{journal.createdById ?? 'Not exposed by this journal contract'}</dd><dt>Source identity</dt><dd>{journal.sourceEventKey}</dd><dt>Original / reversal of</dt><dd>{journal.relatedJournalId ?? journal.reversalOfJournalId ?? 'None'}</dd></dl>
      {journal.bankTransaction ? <p className={styles.note}>Bank source: {journal.bankTransaction.id} · Statement {journal.bankTransaction.statementUpload.id} · {journal.bankTransaction.statementUpload.fileName}</p> : <p className={styles.note}>Non-bank journal; no bank transaction is implied.</p>}
      <CoreTable label="Posted journal lines" headers={['Account', 'Debit', 'Credit', 'Fund ID', 'Bank ID']}>
        {journal.lines.map(line => <tr key={line.id}><td>{line.accountCodeSnapshot} · {line.accountNameSnapshot}</td><td>{accountingMoney(line.debit)}</td><td>{accountingMoney(line.credit)}</td><td>{line.accountingFundId ?? 'None'}</td><td>{line.bankAccountId ?? 'None'}</td></tr>)}
      </CoreTable>{total ? <div className={styles.summary}><span>Journal debit: {accountingMoney(centsDecimal(total.debit))}</span><span>Journal credit: {accountingMoney(centsDecimal(total.credit))}</span></div> : null}
      <p className={styles.note}>Approval history is available by approval request ID in the Accounting approval workspace. The journal detail API does not expose a journal-to-approval history lookup.</p>
      {journal.relatedJournalId || journal.linkedJournals.length ? <p className={styles.note}>Related journal references: {journal.relatedJournalId ?? ''} {journal.linkedJournals.map(item => `${item.journalNumber} (${item.id}, ${item.journalType})`).join(' · ')}</p> : null}
      {user.menuCodes.includes(journalPermissions.manage) && journal.state === 'POSTED' && !journal.reversalOfJournalId
        && !journal.linkedJournals.some(related => related.journalType === 'REVERSAL') ? <Link className={styles.link}
          href={'/accounting/schedules/new?journalId=' + encodeURIComponent(id)}>Use posted balance in a recognition schedule</Link> : null}
      {user.menuCodes.includes(journalPermissions.manage) && journal.state === 'POSTED' && !journal.reversalOfJournalId
        && ['AP_DOCUMENT', 'MANUAL_JOURNAL'].includes(journal.sourceKind) && !journal.linkedJournals.some(related => related.journalType === 'REVERSAL')
        ? <Link className={styles.link} href={'/accounting/assets/new?journalId=' + encodeURIComponent(id)}>Register an asset from this journal</Link> : null}
      {mayReverse && !approvalId ? <><h3>Request a reversal</h3><p className={styles.note}>Independent review and authorized posting are required. The backend rejects repeated reversals; the original remains immutable.</p><CoreInput label="Reversal accounting date" type="date" value={reversalDate} onChange={e => { setReversalDate(e.target.value); setConfirm(false); }} /><CoreInput label="Reversal reason" maxLength={1000} value={remark} onChange={e => { setRemark(e.target.value); setConfirm(false); }} />{periodReason || reversalDate < journal.accountingDate.slice(0, 10) ? <p className={styles.warning}>{periodReason || 'Reversal cannot predate the original journal.'}</p> : null}<Button disabled={mutation.busy || !!periodReason || !remark.trim() || reversalDate < journal.accountingDate.slice(0, 10)} onClick={() => setConfirm(true)}>Review reversal request</Button></> : null}
      {approvalId ? <Link className={styles.link} href={`/accounting/approvals?id=${encodeURIComponent(approvalId)}`}>Open reversal approval request</Link> : null}
    </> : null}{confirm ? <div className={styles.page}><p className={styles.warning}>Submit reversal of {journal?.journalNumber ?? id} dated {reversalDate} for independent approval? This does not delete or immediately reverse the original journal.</p><div className={styles.actions}><Button disabled={mutation.busy} onClick={() => void submitReversal()}>{mutation.busy ? 'Submitting…' : 'Confirm reversal request'}</Button><Button variant="outline" disabled={mutation.busy} onClick={() => setConfirm(false)}>Cancel</Button></div></div> : null}</div></Modal></>;
}

function DraftDetails({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const read = useCoreRead<Draft>(`journal-drafts/${id}`), [editing, setEditing] = useState(false), [confirm, setConfirm] = useState(false), [approvalId, setApprovalId] = useState('');
  const mutation = useCoreMutation(), fiscal = useFiscalYears(), draft = read.data, periodReason = draft ? openDateReason(fiscal.data, draft.accountingDate.slice(0, 10)) : 'Load the draft first.';
  const eligible = draft && draft.status === 'DRAFT' && ['MANUAL_JOURNAL', 'ADJUSTING_JOURNAL'].includes(draft.sourceKind);
  async function submit() {
    if (!draft || !eligible) return;
    const result = await mutation.run(() => requestApproval({ kind: draft.journalType === 'MANUAL' ? 'MANUAL_JOURNAL' : 'ADJUSTING_JOURNAL', sourceDocumentId: draft.id, expectedRevision: draft.revision }), 'Independent approval requested. Nothing has been posted.');
    if (result) { setConfirm(false); setApprovalId(result.id); onChanged(); read.refresh(); }
  }
  if (editing && draft) return <DraftForm draft={draft} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); read.refresh(); onChanged(); }} />;
  return <><Modal open title={draft?.draftNumber ?? 'Journal draft'} onClose={() => { if (!mutation.busy) onClose(); }}><div className={styles.modal}><CoreReadState read={read} /><CoreReadState read={fiscal} /><CoreFeedback {...mutation} />{draft && !read.error ? <><AccountingStatusIndicator status={draft.status} /><p className={styles.note}>Revision {draft.revision} · {draft.accountingDate.slice(0, 10)} · {draft.sourceReference}</p><p>{draft.description}</p><CoreTable label="Saved draft lines" headers={['Account ID', 'Debit', 'Credit']}>{draft.lines.map((line, index) => <tr key={index}><td>{line.accountId}</td><td>{accountingMoney(line.debit)}</td><td>{accountingMoney(line.credit)}</td></tr>)}</CoreTable>
    {eligible ? <div className={styles.actions}><Button variant="outline" disabled={mutation.busy || confirm} onClick={() => setEditing(true)}>Revise draft</Button><Button disabled={mutation.busy || !!periodReason || !!approvalId || read.loading} onClick={() => setConfirm(true)}>Request approval</Button></div> : <p className={styles.note}>This draft cannot be revised here. Posted journals are immutable; source-specific drafts use their later workspace.</p>}{periodReason ? <p className={styles.warning}>{periodReason}</p> : null}{approvalId ? <Link className={styles.link} href={`/accounting/approvals?id=${encodeURIComponent(approvalId)}`}>Open approval request</Link> : null}</> : null}{confirm ? <div className={styles.page}><p className={styles.warning}>Submit revision {draft?.revision ?? ''} to the configured independent Accounting reviewers? Posting remains a separate authorized action.</p><div className={styles.actions}><Button disabled={mutation.busy} onClick={() => void submit()}>{mutation.busy ? 'Submitting…' : 'Confirm approval request'}</Button><Button variant="outline" disabled={mutation.busy} onClick={() => setConfirm(false)}>Cancel</Button></div></div> : null}</div></Modal></>;
}

export function JournalWorkspace({ initialJournalId = '' }: { initialJournalId?: string }) {
  const user = useAuthSession(), manage = user.menuCodes.includes(journalPermissions.manage);
  const [filters, setFilters] = useCoreSelection('journals', { from: `${currentBusinessMonthValue()}-01`, to: currentBusinessDayValue(), yearId: '', periodId: '', journalNumber: '', page: 1, mode: 'posted' });
  const fiscal = useFiscalYears(), [detail, setDetail] = useState(initialJournalId), [draftId, setDraftId] = useState(''), [creating, setCreating] = useState(false), [message, setMessage] = useState('');
  const valid = !!filters.from && !!filters.to && filters.from <= filters.to;
  const read = useCoreRead<AccountingReport>(`reports?${coreQuery({ view: 'journals', from: filters.from, to: filters.to, journalNumber: filters.journalNumber, page: filters.page, pageSize: 25 })}`, filters.mode === 'posted' && valid);
  const drafts = useCoreRead<AccountingPage<DraftHeader>>(`journal-drafts?${coreQuery({ page: filters.page, pageSize: 25 })}`, manage && filters.mode === 'drafts');
  const update = (next: Partial<typeof filters>) => setFilters({ ...filters, ...next, page: 1 });
  return <CorePage title="Accounting Journals" description="Posted journal evidence and your manual/adjusting drafts. Approval and posting remain separate." actions={<><Button variant="outline" onClick={() => { read.refresh(); drafts.refresh(); }} disabled={read.loading || drafts.loading}>Refresh</Button>{manage ? <Button onClick={() => setCreating(true)}>Create journal draft</Button> : null}</>}>
    <CorePolicyNote /><CoreFeedback error="" message={message} /><div className={styles.actions}><Button variant={filters.mode === 'posted' ? 'primary' : 'outline'} onClick={() => update({ mode: 'posted' })}>Posted journals</Button>{manage ? <Button variant={filters.mode === 'drafts' ? 'primary' : 'outline'} onClick={() => update({ mode: 'drafts' })}>My drafts</Button> : null}</div>
    {filters.mode === 'posted' ? <CoreCard><div className={styles.filters}><FiscalScope value={filters} onChange={update} read={fiscal} /><CoreInput label="Journal number search" maxLength={60} value={filters.journalNumber} onChange={e => update({ journalNumber: e.target.value })} /><CoreInput label="Journal from date" type="date" value={filters.from} onChange={e => update({ from: e.target.value })} /><CoreInput label="Journal to date" type="date" value={filters.to} onChange={e => update({ to: e.target.value })} /></div>
      <p className={styles.note}>Period selection applies its date range. The list API does not offer general source-type, lifecycle-status or accountingPeriodId filters. Source/period/posting metadata is available in detail. All rows here are posted evidence, not approval requests.</p>{!valid ? <p role="alert">Choose a valid date range.</p> : null}<CoreReadState read={read} empty={read.data?.rows.length === 0} />
      {read.data && !read.loading && !read.error ? <><CoreTable label="Posted journals" headers={['Date', 'Journal', 'Type', 'Bank source ID', 'Debit', 'Credit', 'Related journal']}>
        {read.data.rows.map(row => <tr key={String(row.id)}><td>{row.date}</td><td><Button variant="ghost" onClick={() => setDetail(String(row.id))}>{row.journal}</Button></td><td>{row.type}</td><td>{row.source ?? 'See detail for non-bank source'}</td><td>{accountingMoney(text(row.debit))}</td><td>{accountingMoney(text(row.credit))}</td><td>{row.relatedJournal ?? 'None'}</td></tr>)}
      </CoreTable><CorePagination {...read.data} loading={read.loading} onPage={page => setFilters({ ...filters, page })} /></> : null}
    </CoreCard> : manage ? <CoreCard><CoreReadState read={drafts} empty={drafts.data?.rows.length === 0} />{drafts.data && !drafts.loading && !drafts.error ? <><CoreTable label="Your journal drafts" headers={['Draft', 'Date', 'Type', 'Revision', 'Status', 'Posted journal']}>
      {drafts.data.rows.map(row => <tr key={row.id}><td><Button variant="ghost" onClick={() => setDraftId(row.id)}>{row.draftNumber}</Button></td><td>{row.accountingDate.slice(0, 10)}</td><td>{row.journalType}</td><td>{row.revision}</td><td><AccountingStatusIndicator status={row.status} /></td><td>{row.postedJournalId ?? 'Not posted'}</td></tr>)}
    </CoreTable><CorePagination {...drafts.data} loading={drafts.loading} onPage={page => setFilters({ ...filters, page })} /></> : null}</CoreCard> : <CoreCard><p>Additional journal management permission is required for own drafts.</p></CoreCard>}
    {detail ? <JournalDetailPanel key={detail} id={detail} onClose={() => setDetail('')} /> : null}{draftId && manage ? <DraftDetails key={draftId} id={draftId} onClose={() => setDraftId('')} onChanged={drafts.refresh} /> : null}
    {creating && manage ? <DraftForm draft={null} onClose={() => setCreating(false)} onSaved={draft => { setCreating(false); setMessage('Draft saved. Request independent approval before posting.'); update({ mode: 'drafts' }); setDraftId(draft.id); drafts.refresh(); }} /> : null}
  </CorePage>;
}
