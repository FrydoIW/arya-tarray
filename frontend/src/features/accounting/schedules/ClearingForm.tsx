'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { saveDocument } from '../apar/api';
import { MoneyField, PartyChoice, positiveAmount, TextArea, validDay } from '../apar/fields';
import type { DocumentInput, Side } from '../apar/types';
import { AccountLookupSearch, AccountSelect, useAccountLookup } from '../core/AccountLookup';
import { CoreFeedback, CoreField, CoreInput } from '../core/CoreUI';
import { useCoreMutation } from '../core/hooks';
import { accountingMoney, decimalCents } from '../core/presentation';
import { routeId } from '../core/route-scope';
import styles from '../core/core.module.css';
import type { Accrual } from './types';

export const documentArea = (side: Side) => side === 'ap' ? 'payables' : 'receivables';
export const documentLink = (side: Side, id: string) => '/accounting/' + documentArea(side) + '/' + id;
export const accrualSide = (kind: Accrual['metadata']['kind']): Side => kind === 'ACCRUED_EXPENSE' ? 'ap' : 'ar';

export function ClearingForm({ source }: { source: Accrual }) {
  const side = accrualSide(source.metadata.kind);
  const router = useRouter(), accounts = useAccountLookup(), mutation = useCoreMutation();
  const [issue, setIssue] = useState('');
  const [amount, setAmount] = useState('');
  const [form, setForm] = useState<Omit<DocumentInput, 'lines' | 'accrualDraftId'>>({
    counterpartyId: source.balance.counterpartyId ?? '', controlAccountId: '', documentNumber: '', sourceReference: '',
    recognitionBasis: '', documentDate: '', accountingDate: '', dueDate: '',
  });
  const update = (value: Partial<typeof form>) => setForm({ ...form, ...value });
  async function save() {
    const cents = positiveAmount(amount);
    const remaining = decimalCents(source.remaining);
    const error = cents === null || remaining === null || cents > remaining ? 'Enter a positive exact amount within the backend remaining balance.'
      : !routeId(form.counterpartyId) || !routeId(form.controlAccountId) || form.controlAccountId === source.balance.accountId
        ? 'Select a counterparty and a distinct control account.'
        : ![form.documentDate, form.accountingDate, form.dueDate].every(validDay) || form.dueDate < form.documentDate
          ? 'Enter valid accounting, document, and due dates. The due date cannot precede the document.'
          : !form.documentNumber.trim() || !form.sourceReference.trim() || form.recognitionBasis.trim().length < 10
            ? 'Enter a document number, source reference, and recognition evidence.' : '';
    setIssue(error);
    if (error) return;
    const result = await mutation.run(() => saveDocument(side, { ...form, accrualDraftId: source.id, lines: [{
      accountingAccountId: source.balance.accountId, amount, description: 'Clearing accrual ' + source.sourceReference,
      accountingFundId: null, eventCampaignId: null,
    }] }), 'Clearing draft saved.');
    if (result) router.push(documentLink(side, result.id));
  }
  return <form className={styles.page} noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
    <CoreFeedback error={issue || mutation.error} message={mutation.message} />
    <p className={styles.note}>Backend remaining accrual {accountingMoney(source.remaining)}. This draft uses the original accrual balance account as its sole offset. Review and posting continue in {side.toUpperCase()}.</p>
    <fieldset className={styles.page} disabled={mutation.busy}>
      {source.balance.counterpartyId ? <p>Original counterparty ID · {source.balance.counterpartyId}</p>
        : <PartyChoice side={side} required value={form.counterpartyId} onChange={counterpartyId => update({ counterpartyId })} />}
      <AccountLookupSearch lookup={accounts} />
      <CoreField label="Clearing document control account"><AccountSelect label="Clearing document control account" mode="posting" value={form.controlAccountId}
        onChange={controlAccountId => update({ controlAccountId })} rows={(accounts.read.data?.rows ?? []).filter(row =>
          row.id !== source.balance.accountId && !row.contraFlag && row.accountType === (side === 'ap' ? 'LIABILITY' : 'ASSET'))} /></CoreField>
      <div className={styles.formGrid}>
        <CoreInput label="Document number" maxLength={100} value={form.documentNumber} onChange={event => update({ documentNumber: event.target.value })} />
        <CoreInput label="Document source reference" maxLength={255} value={form.sourceReference} onChange={event => update({ sourceReference: event.target.value })} />
        <CoreInput label="Document date" type="date" value={form.documentDate} onChange={event => update({ documentDate: event.target.value })} />
        <CoreInput label="Accounting date" type="date" value={form.accountingDate} onChange={event => update({ accountingDate: event.target.value })} />
        <CoreInput label="Due date" type="date" value={form.dueDate} onChange={event => update({ dueDate: event.target.value })} />
        <MoneyField label="Amount to clear" value={amount} onChange={setAmount} />
      </div>
      <TextArea label="Clearing recognition evidence" minLength={10} maxLength={1000} value={form.recognitionBasis} onChange={recognitionBasis => update({ recognitionBasis })} />
      <div><Button type="submit" disabled={mutation.busy}>Save linked clearing draft</Button></div>
    </fieldset>
  </form>;
}
