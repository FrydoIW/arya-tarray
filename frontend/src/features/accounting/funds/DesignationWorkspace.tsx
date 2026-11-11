'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import type { AccountingPage } from '../types';
import { ApprovalLink, ChoiceField, MoneyField, TextArea, positiveAmount, validDay } from '../apar/fields';
import { coreQuery } from '../core/api';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { CoreCard, CoreFeedback, CoreInput, CorePage, CorePagination, CoreReadState, CoreTable } from '../core/CoreUI';
import { useCoreMutation, useCoreRead } from '../core/hooks';
import { accountingMoney } from '../core/presentation';
import { journalPermissions } from '../core/contracts.generated';
import styles from '../core/core.module.css';
import { createDesignation, createFundCommand } from './api';
import { FundSourceActions } from './FundActions';
import { classLabel, designationHref, FundNavigation, fundHref, fundsHref, movementHref } from './FundUI';
import type { Designation, DesignationDetail, DesignationInput, Fund, FundCommand, FundMovement } from './types';

function FundChoice({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const read = useCoreRead<AccountingPage<Fund>>('funds?page=1&pageSize=100&status=ACTIVE');
  return <><ChoiceField label="Unrestricted fund scope" value={value} onChange={onChange} required empty="Select unrestricted fund"
    choices={(read.data?.rows ?? []).filter(row => row.fundClass === 'UNRESTRICTED').map(row => ({ id: row.id, label: `${row.fundCode} · ${row.fundName}` }))} /><CoreReadState read={read} /></>;
}

function DesignationForm({ fund, onSaved }: { fund: Fund; onSaved: (row: Designation) => void }) {
  const user = useAuthSession(), mutation = useCoreMutation();
  const [input, setInput] = useState<DesignationInput>({ designationReference: '', purposeText: '', amount: '', effectiveOn: '' });
  const valid = input.designationReference.trim() && input.purposeText.trim().length >= 10 && positiveAmount(input.amount) !== null && validDay(input.effectiveOn);
  async function submit(event: React.FormEvent) { event.preventDefault(); if (!valid || !user.menuCodes.includes(journalPermissions.manage)) return;
    const row = await mutation.run(() => createDesignation(fund.id, input), 'Internal designation draft created. It does not create cash, revenue or a GL journal.'); if (row) onSaved(row); }
  return <CoreCard><h2>Create internal designation</h2><p className={styles.note}>A board/management designation is not a donor restriction and does not move cash or recognize income.</p><CoreFeedback {...mutation} />
    <form className={styles.page} onSubmit={submit}><div className={styles.formGrid}><CoreInput label="Designation reference" required maxLength={100} value={input.designationReference} onChange={e => setInput(old => ({ ...old, designationReference: e.target.value }))} />
      <MoneyField label="Designated amount" value={input.amount} onChange={amount => setInput(old => ({ ...old, amount }))} /><CoreInput label="Effective date" type="date" required value={input.effectiveOn} onChange={e => setInput(old => ({ ...old, effectiveOn: e.target.value }))} /></div>
      <TextArea label="Supporting decision and purpose" minLength={10} maxLength={1000} value={input.purposeText} onChange={purposeText => setInput(old => ({ ...old, purposeText }))} />
      <Button type="submit" disabled={!valid || mutation.busy || !user.menuCodes.includes(journalPermissions.manage)}>Create designation draft</Button></form></CoreCard>;
}

function DesignationCommand({ designation, onCreated }: { designation: DesignationDetail; onCreated: (row: FundMovement) => void }) {
  const user = useAuthSession(), mutation = useCoreMutation(), [action, setAction] = useState<'DESIGNATION_ADJUST' | 'DESIGNATION_RELEASE' | 'DESIGNATION_CANCEL'>('DESIGNATION_ADJUST');
  const [date, setDate] = useState(''), [reference, setReference] = useState(''), [reason, setReason] = useState(''), [amount, setAmount] = useState(designation.amount), [purpose, setPurpose] = useState(designation.purposeText), [confirm, setConfirm] = useState(false);
  const valid = validDay(date) && reference.trim() && reason.trim().length >= 10 && (action !== 'DESIGNATION_ADJUST' || positiveAmount(amount) !== null && purpose.trim().length >= 10);
  async function submit() {
    if (!valid || !user.menuCodes.includes(journalPermissions.manage)) return;
    const common = { accountingDate: date, sourceReference: reference, reason };
    const command: FundCommand = action === 'DESIGNATION_ADJUST' ? { ...common, action, designationId: designation.id, amount, purposeText: purpose }
      : { ...common, action, designationId: designation.id };
    const row = await mutation.run(() => createFundCommand(designation.accountingFundId, command), 'Designation command draft created. Independent approval and authorized application remain required.');
    setConfirm(false); if (row) onCreated(row);
  }
  return <CoreCard><h2>Adjust or end active designation</h2><CoreFeedback {...mutation} /><ChoiceField label="Designation command" value={action} onChange={value => setAction(value as typeof action)} choices={[
    { id: 'DESIGNATION_ADJUST', label: 'Adjust amount/purpose' }, { id: 'DESIGNATION_RELEASE', label: 'Release management designation' }, { id: 'DESIGNATION_CANCEL', label: 'Cancel management designation' }
  ]} required /><div className={styles.formGrid}><CoreInput label="Accounting date" type="date" value={date} onChange={e => setDate(e.target.value)} /><CoreInput label="Command reference" maxLength={110} value={reference} onChange={e => setReference(e.target.value)} />
    {action === 'DESIGNATION_ADJUST' ? <MoneyField label="Revised amount" value={amount} onChange={setAmount} /> : null}</div>
    {action === 'DESIGNATION_ADJUST' ? <TextArea label="Revised management purpose" minLength={10} maxLength={1000} value={purpose} onChange={setPurpose} /> : null}<TextArea label="Command reason/evidence" minLength={10} maxLength={1000} value={reason} onChange={setReason} />
    <Button disabled={!valid || mutation.busy || !user.menuCodes.includes(journalPermissions.manage)} onClick={() => setConfirm(true)}>Create command draft</Button>
    <ConfirmDialog open={confirm} title="Create designation command?" message="Create a separate auditable command. This action does not move cash, post revenue or modify the designation until independently approved and applied." confirmLabel="Confirm command" loading={mutation.busy} onCancel={() => setConfirm(false)} onConfirm={submit} />
  </CoreCard>;
}

export function DesignationWorkspace({ fundId: initialFundId = '', id, create = false }: { fundId?: string; id?: string; create?: boolean }) {
  const router = useRouter(), [fundId, setFundId] = useState(initialFundId), [page, setPage] = useState(1);
  const fund = useCoreRead<Fund>(fundId ? 'funds/' + fundId : 'funds/disabled', !!fundId);
  const list = useCoreRead<AccountingPage<Designation>>(`funds/${fundId}/designations?${coreQuery({ page, pageSize: 25 })}`, !!fundId && !id && !create);
  const detail = useCoreRead<DesignationDetail>(id ? 'fund-designations/' + id : 'fund-designations/disabled', !!id);
  const actualFundId = detail.data?.accountingFundId ?? fundId;
  const detailFund = useCoreRead<Fund>(actualFundId ? 'funds/' + actualFundId : 'funds/disabled', !!actualFundId && fund.data?.id !== actualFundId);
  const currentFund = fund.data?.id === actualFundId ? fund.data : detailFund.data;
  if (create) return <CorePage title="New internal designation" description="Record a management allocation without creating a donor restriction or GL event."><FundNavigation fund={currentFund} /><FundChoice value={fundId} onChange={value => { setFundId(value); router.replace(`${fundsHref}/designations/new?fundId=${value}`); }} />{currentFund ? <DesignationForm fund={currentFund} onSaved={row => router.push(designationHref(row.id))} /> : null}</CorePage>;
  if (id) { const row = detail.data; return <CorePage title="Internal designation" description="Management purpose, independent approval and retained history." actions={<Button variant="outline" onClick={detail.refresh}>Refresh designation</Button>}><FundNavigation fund={currentFund} /><CoreReadState read={detail} />{row ? <>
    <CoreCard><div className={styles.summary}><h2>{row.designationReference}</h2><AccountingStatusIndicator status={row.status} /></div><dl className={styles.details}><dt>Fund</dt><dd>{currentFund ? <Link className={styles.link} href={fundHref(currentFund.id)}>{currentFund.fundCode} · {classLabel[currentFund.fundClass]}</Link> : row.accountingFundId}</dd><dt>Purpose</dt><dd>{row.purposeText}</dd><dt>Amount / effective date</dt><dd>{accountingMoney(row.amount)} / {row.effectiveOn.slice(0, 10)}</dd><dt>Approved by / at</dt><dd>{row.approvedById ?? 'Not approved'} / {row.approvedAt ?? 'Not approved'}</dd></dl><FundSourceActions path="fund-designations" source={row} onChanged={detail.refresh} /></CoreCard>
    {row.status === 'ACTIVE' ? <DesignationCommand designation={row} onCreated={command => router.push(movementHref(command.id))} /> : null}
    <CoreCard><h2>Approval history</h2>{row.history.length ? <CoreTable label="Designation approval history" headers={['Request', 'Requester', 'Status', 'Version', 'Digest']}>{row.history.map(request => <tr key={request.id}><td><ApprovalLink id={request.id}>{request.id}</ApprovalLink></td><td>{request.requestedById}</td><td><AccountingStatusIndicator status={request.status} /></td><td>{request.sourceVersion}</td><td className={styles.wrap}>{request.sourceDigest}</td></tr>)}</CoreTable> : <p className={styles.note}>No approval history.</p>}</CoreCard></> : null}</CorePage>; }
  return <CorePage title="Internal designations" description="Management allocations kept separate from donor restrictions and cash balances." actions={fundId ? <Link className={styles.link} href={`${fundsHref}/designations/new?fundId=${fundId}`}>New designation</Link> : null}><FundNavigation fund={fund.data} /><FundChoice value={fundId} onChange={value => { setFundId(value); setPage(1); router.replace(`${fundsHref}/designations?fundId=${value}`); }} />
    {fundId ? <CoreCard><CoreReadState read={list} empty={list.data?.rows.length === 0} />{list.data?.rows.length ? <><CoreTable label="Internal designations" headers={['Reference', 'Purpose', 'Amount', 'Effective', 'Status']}>{list.data.rows.map(row => <tr key={row.id}><td><Link className={styles.link} href={designationHref(row.id)}>{row.designationReference}</Link></td><td className={styles.wrap}>{row.purposeText}</td><td>{accountingMoney(row.amount)}</td><td>{row.effectiveOn.slice(0, 10)}</td><td><AccountingStatusIndicator status={row.status} /></td></tr>)}</CoreTable><CorePagination {...list.data} loading={list.loading} onPage={setPage} /></> : null}</CoreCard> : null}
  </CorePage>;
}
