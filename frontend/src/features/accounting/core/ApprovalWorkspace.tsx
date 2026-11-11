"use client";
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import { managementGrant, postSource } from '../apar/api';
import { AparApprovalEvidence, readAparApproval } from '../apar/ApprovalEvidence';
import { JournalLink } from '../apar/fields';
import { applyAssetApproval } from '../assets/api';
import { AssetApprovalEvidence, readAssetApproval } from '../assets/ApprovalEvidence';
import { applyStage23Approval } from '../schedules/api';
import { readScheduleApproval, ScheduleApprovalEvidence } from '../schedules/ApprovalEvidence';
import { applyFundApproval } from '../funds/api';
import { FundApprovalEvidence, readFundApproval } from '../funds/ApprovalEvidence';
import { FinalizationApprovalEvidence, readFinalizationApproval } from '../finalization/ApprovalEvidence';
import type { AccountingPage } from '../types';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { approvalStatuses, journalPermissions } from './contracts.generated';
import { cancelApproval, coreQuery, decideApproval, postApproval } from './api';
import { CoreCard, CoreFeedback, CoreInput, CorePage, CorePagination, CorePolicyNote, CoreReadState, CoreTable } from './CoreUI';
import { useCoreMutation, useCoreRead, useCoreSelection } from './hooks';
import { accountingMoney, coreApprovalKind, record, text } from './presentation';
import { openDateReason, useFiscalYears } from './FiscalScope';
import { routeId } from './route-scope';
import type { Approval, ApprovalDetail } from './types';
import styles from './core.module.css';

function ApprovalReview({ id, onChanged }: { id: string; onChanged: () => void }) {
  const user = useAuthSession(), read = useCoreRead<ApprovalDetail>(`approvals/${id}`), fiscal = useFiscalYears(), mutation = useCoreMutation();
  const [remark, setRemark] = useState(''), [action, setAction] = useState<'APPROVED' | 'REJECTED' | 'POST' | 'CANCEL' | null>(null);
  const request = read.data, source = record(request?.source), original = record(source?.original), payload = record(source?.payload);
  const material = original ?? source, rawLines = material?.lines;
  const lines = Array.isArray(rawLines) ? rawLines.map(record).filter((line): line is Record<string, unknown> => line !== null) : [];
  const apar = readAparApproval(request);
  const schedule = readScheduleApproval(request);
  const asset = readAssetApproval(request);
  const fund = readFundApproval(request);
  const finalization = readFinalizationApproval(request);
  const nonfinancial = schedule?.nonfinancial || asset?.nonfinancial || fund?.nonfinancial || finalization?.nonfinancial;
  const date = apar?.date ?? schedule?.date ?? asset?.date ?? fund?.date ?? finalization?.date ?? (request?.requestKind === 'JOURNAL_REVERSAL'
    ? text(payload?.accountingDate).slice(0, 10) : text(source?.accountingDate).slice(0, 10));
  const supported = !!apar || !!schedule || !!asset || !!fund || !!finalization || (!!request && coreApprovalKind(request.requestKind));
  const contextAvailable = apar?.contextAvailable ?? schedule?.contextAvailable ?? asset?.contextAvailable ?? fund?.contextAvailable ?? finalization?.contextAvailable ?? (supported && lines.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(date));
  const stale = apar?.stale ?? schedule?.stale ?? asset?.stale ?? fund?.stale ?? finalization?.stale ?? Boolean(request && source && request.requestKind !== 'JOURNAL_REVERSAL' && source.revision !== request.sourceVersion);
  const reversalKind = request?.requestKind === 'JOURNAL_REVERSAL' ? text(original?.sourceKind) : '';
  let managementPermission: string = journalPermissions.manage;
  if (apar) managementPermission = managementGrant[apar.side];
  else if (['AP_DOCUMENT', 'AP_SETTLEMENT'].includes(reversalKind)) managementPermission = managementGrant.ap;
  else if (['AR_DOCUMENT', 'AR_SETTLEMENT', 'AR_ADJUSTMENT'].includes(reversalKind)) managementPermission = managementGrant.ar;
  const assigned = request?.approvers.some(item => item.approverUserId === user.id), owner = request?.requestedById === user.id;
  const canApprove = user.menuCodes.includes(journalPermissions.approve) && assigned && !owner;
  const canCancel = owner && user.menuCodes.includes(managementPermission) || assigned && user.menuCodes.includes(journalPermissions.approve);
  const periodReason = openDateReason(fiscal.data, date);
  function postingReason() {
    if (!request) return 'Load the approval request.';
    if (!supported) return 'This source workflow belongs to a later Accounting workspace.';
    if (!contextAvailable) return 'Source context is incomplete.';
    if (stale) return 'Source revision differs from the requested version.';
    if (request.status !== 'APPROVED') return 'Independent approval is required before posting.';
    if (!request.decidedById || request.decidedById === request.requestedById
      || !request.approvers.some(item => item.approverUserId === request.decidedById)) {
      return 'An independent assigned reviewer decision is required.';
    }
    return finalization ? '' : nonfinancial ? '' : periodReason;
  }
  const postReason = postingReason();
  async function execute() {
    if (!action || !request || !supported || read.loading || read.error) return;
    const postPath = apar?.postPath;
    let work: () => Promise<unknown>;
    if (action === 'POST') {
      if (postReason || !user.menuCodes.includes(journalPermissions.post)) return;
      work = fund ? () => applyFundApproval(fund.path, fund.id, id) : asset ? () => applyAssetApproval(asset.path, asset.id, id)
        : schedule ? () => applyStage23Approval(schedule.postPath, id) : postPath ? () => postSource(postPath, id) : () => postApproval(id);
    } else if (action === 'CANCEL') {
      if (!canCancel || !['PENDING', 'APPROVED'].includes(request.status) || !remark.trim()) return;
      work = () => cancelApproval(id, remark.trim());
    } else {
      if (!canApprove || request.status !== 'PENDING' || !contextAvailable || stale) return;
      work = () => decideApproval(id, action, remark.trim() || null);
    }
    const result = await mutation.run(work, action === 'POST' && nonfinancial
      ? (fund ? 'Fund command' : asset ? 'Asset command' : 'Schedule command') + ' applied by backend. No journal was created.'
      : action === 'POST'
      ? 'Posting confirmed by backend. Journal and approval state have been refreshed.'
      : 'Accounting approval action confirmed by backend.');
    setAction(null);
    if (result !== undefined) { read.refresh(); onChanged(); }
  }
  const confirmation = action === 'POST' && nonfinancial ? 'Apply this independently approved command. The backend validates the digest and source state. This action creates no journal.'
    : action === 'POST' ? 'Post the independently approved source through the central posting engine. This creates immutable Accounting journal evidence. The backend rechecks digest, revision, period and idempotency atomically.' : action === 'CANCEL' ? 'Cancel this unused approval. It cannot authorize posting afterward; retained history remains available.' : action === 'REJECTED' ? 'Reject this request. It will not authorize posting. The source and your decision remain in the audit history.' : 'Approve the displayed source version and digest as an independent reviewer. This decision does not post a journal.';
  return <CoreCard><h2>Approval request detail</h2><CoreReadState read={read} /><CoreFeedback {...mutation} /><Button variant="outline" disabled={read.loading || mutation.busy} onClick={read.refresh}>Refresh request</Button>
    {request && !read.loading && !read.error ? <><AccountingStatusIndicator status={request.status} /><dl className={styles.details}><dt>Request ID / kind</dt><dd>{request.id} · {request.requestKind}</dd><dt>Source document</dt><dd>{request.sourceDocumentId}</dd><dt>Requester user ID</dt><dd>{request.requestedById}{owner ? ' · You' : ''}</dd><dt>Requested at</dt><dd>{request.requestedAt}</dd><dt>Source version</dt><dd>{request.sourceVersion}</dd><dt>Requested digest</dt><dd>{request.sourceDigest}</dd><dt>Accounting date</dt><dd>{contextAvailable ? date : 'Not available for core review'}</dd><dt>Reviewer / decision time</dt><dd>{request.decidedById ?? 'Not decided'} · {request.decidedAt ?? 'Not decided'}</dd><dt>Decision remark</dt><dd>{request.decisionRemark ?? 'None'}</dd><dt>Posted journal ID</dt><dd>{request.appliedJournalId ?? 'Not applied'}</dd></dl>
      {request.appliedJournalId ? <JournalLink id={request.appliedJournalId} /> : null}
      {apar ? <AparApprovalEvidence evidence={apar} /> : schedule ? <ScheduleApprovalEvidence evidence={schedule} /> : asset ? <AssetApprovalEvidence review={asset} /> : fund ? <FundApprovalEvidence review={fund} /> : finalization ? <FinalizationApprovalEvidence review={finalization} /> : supported ? <><h3>{original ? 'Original journal to be reversed' : 'Source journal draft'}</h3><dl className={styles.details}><dt>Reference</dt><dd>{text(material?.sourceReference)}</dd><dt>Description</dt><dd>{text(material?.description ?? material?.descriptionSnapshot)}</dd><dt>Source status / revision</dt><dd>{text(material?.status)} · {text(material?.revision)}</dd><dt>Reversal reason</dt><dd>{text(payload?.remark)}</dd></dl><CoreTable label="Approval source journal lines" headers={['Account', 'Debit', 'Credit', 'Bank / Fund IDs']}>
        {lines.map((line, index) => <tr key={index}><td>{text(line.accountCodeSnapshot ?? line.accountId)} {text(line.accountNameSnapshot) === 'Not supplied' ? '' : text(line.accountNameSnapshot)}</td><td>{accountingMoney(typeof line.debit === 'string' ? line.debit : null)}</td><td>{accountingMoney(typeof line.credit === 'string' ? line.credit : null)}</td><td>{text(line.bankAccountId)} / {text(line.accountingFundId)}</td></tr>)}
      </CoreTable><p className={styles.note}>These are source line amounts. For a reversal the backend generates compensating lines; the original is retained. No independent posting preview or current digest is supplied by this detail endpoint; the backend validates the live digest when deciding and posting.</p></> : <p className={styles.warning}>This request belongs to a later transaction workspace. Core UI shows audit metadata only; decisions/posting are not enabled without its source-specific review UI.</p>}
      <CoreReadState read={fiscal} />{owner ? <p className={styles.warning}>You requested this approval. You cannot approve or reject your own request.</p> : null}
      {stale ? <p role="alert" className={styles.warning}>Source version is stale. Request a new approval for the current revision.</p> : null}
      {supported ? <><CoreInput label="Decision / cancellation remark" maxLength={1000} disabled={mutation.busy} value={remark} onChange={e => setRemark(e.target.value)} /><div className={styles.actions}>
        {canApprove ? <><Button disabled={mutation.busy || request.status !== 'PENDING' || !contextAvailable || stale} onClick={() => setAction('APPROVED')}>Approve request</Button><Button variant="danger" disabled={mutation.busy || request.status !== 'PENDING' || !contextAvailable || stale} onClick={() => setAction('REJECTED')}>Reject request</Button></> : null}
        {user.menuCodes.includes(journalPermissions.post) ? <Button disabled={mutation.busy || !!postReason} onClick={() => setAction('POST')}>{nonfinancial ? 'Apply approved command' : 'Post approved journal'}</Button> : null}
        {canCancel ? <Button variant="outline" disabled={mutation.busy || !['PENDING', 'APPROVED'].includes(request.status) || !remark.trim()} onClick={() => setAction('CANCEL')}>Cancel request</Button> : null}
      </div><p className={styles.note}>{postReason || 'Eligible for posting based on the displayed source. The backend remains the final authority.'}</p>{!user.menuCodes.includes(journalPermissions.post) ? <p className={styles.note}>Journal posting permission is required; no posting action is available to this user.</p> : null}</> : null}
      <h3>Retained approval history</h3><p className={styles.note}>History limit: {request.historyLimit}. Identities are IDs because this endpoint does not expose user display names.</p><CoreTable label="Approval history" headers={['Action / at', 'Actor ID', 'Before', 'After', 'Remark', 'Digest']}>
        {request.history.map(item => <tr key={item.id}><td>{item.action} · {item.actionAt}</td><td>{item.actorId}</td><td>{item.statusBefore ?? 'None'}</td><td>{item.statusAfter}</td><td className={styles.wrap}>{item.remark ?? 'None'}</td><td className={styles.wrap}>{item.sourceDigest}</td></tr>)}
      </CoreTable>
    </> : null}<ConfirmDialog open={!!action} title={action === 'POST' ? 'Confirm Accounting posting' : action === 'CANCEL' ? 'Cancel approval request?' : action === 'REJECTED' ? 'Reject Accounting request?' : 'Approve Accounting request?'} message={confirmation} confirmLabel="Confirm Accounting action" loading={mutation.busy} onCancel={() => setAction(null)} onConfirm={execute} />
  </CoreCard>;
}

export function ApprovalWorkspace({ initialId = '' }: { initialId?: string }) {
  const user = useAuthSession(), canRead = [journalPermissions.manage, journalPermissions.approve, journalPermissions.post, 'ACCOUNTING_AP_MANAGE', 'ACCOUNTING_AR_MANAGE'].some(code => user.menuCodes.includes(code));
  const [filters, setFilters] = useCoreSelection('approvals', { status: 'PENDING', page: 1 }), [id, setId] = useState(initialId), [lookupId, setLookupId] = useState('');
  const read = useCoreRead<AccountingPage<Approval>>(`approvals?${coreQuery({ ...filters, pageSize: 25 })}`, canRead);
  return <CorePage title="Accounting Approval" description="Independent review, source-version evidence and authorized posting." actions={<Button variant="outline" disabled={!canRead || read.loading} onClick={read.refresh}>Refresh queue</Button>}>
    <CorePolicyNote />{!canRead ? <CoreCard><h2>Additional Accounting access required</h2><p className={styles.note}>Report permission does not grant approval inbox, review or posting authority.</p></CoreCard> : <>
      <CoreCard><form className={styles.toolbar} onSubmit={event => { event.preventDefault(); const selected = routeId(lookupId); if (selected) setId(selected); }}><CoreInput label="Approval request ID" value={lookupId} onChange={event => setLookupId(event.target.value)} placeholder="Request UUID shared by the requester" /><Button type="submit" variant="outline" disabled={!routeId(lookupId)}>Open request by ID</Button></form><p className={styles.note}>Authorized posters may open a shared request ID even when it is outside their actor-scoped queue. The backend checks access to its detail.</p></CoreCard>
      {id ? <ApprovalReview key={id} id={id} onChanged={read.refresh} /> : null}
      <CoreCard><div className={styles.toolbar}><Select aria-label="Approval status" value={filters.status} onChange={e => setFilters({ status: e.target.value, page: 1 })}><option value="">All statuses / history</option>{approvalStatuses.map(status => <option key={status}>{status}</option>)}</Select>{id ? <Button variant="outline" onClick={() => setId('')}>Close request detail</Button> : null}</div>
        <p className={styles.note}>This queue contains requests you submitted or were assigned to review. It is not a global inbox. The backend does not support a separate submitted-by-me query; the relationship is identified per returned row.</p><CoreReadState read={read} empty={read.data?.rows.length === 0} />
        {read.data && !read.loading && !read.error ? <><CoreTable label="Accounting approval inbox" headers={['Request', 'Kind / source', 'Your relationship', 'Requester ID', 'Requested', 'Status']}>
          {read.data.rows.map(row => <tr key={row.id}><td><Button variant="ghost" onClick={() => { setId(row.id); window.history.replaceState(window.history.state, '', `/accounting/approvals?id=${encodeURIComponent(row.id)}`); }}>{row.id}</Button></td><td>{row.requestKind}<br />{row.sourceDocumentId}</td><td>{row.requestedById === user.id ? 'Submitted by you' : 'Assigned to you'}</td><td>{row.requestedById}</td><td>{row.requestedAt}</td><td><AccountingStatusIndicator status={row.status} /></td></tr>)}
        </CoreTable><CorePagination {...read.data} loading={read.loading} onPage={page => setFilters({ ...filters, page })} /></> : null}
        <Link className={styles.link} href="/accounting/journals">Manage your journal drafts and request approval</Link>
      </CoreCard>
    </>}
  </CorePage>;
}
