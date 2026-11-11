'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ChoiceField, MoneyField, PartyChoice, positiveAmount, TextArea, validDay } from '../apar/fields';
import { AccountLookupSearch, AccountSelect, useAccountLookup } from '../core/AccountLookup';
import { CoreFeedback, CoreField, CoreInput } from '../core/CoreUI';
import { useCoreMutation } from '../core/hooks';
import { routeId } from '../core/route-scope';
import styles from '../core/core.module.css';
import { saveAccrual } from './api';
import type { Accrual, AccrualInput } from './types';

export function AccrualForm({ existing, onSaved }: { existing?: Accrual; onSaved?: () => void }) {
  const router = useRouter();
  const accounts = useAccountLookup();
  const mutation = useCoreMutation();
  const [issue, setIssue] = useState('');
  const [form, setForm] = useState<AccrualInput>(() => existing ? {
    sourceReference: existing.sourceReference, accountingDate: existing.accountingDate.slice(0, 10),
    amount: existing.originalAmount, recognitionAccountId: existing.recognition.accountId,
    balanceAccountId: existing.balance.accountId, counterpartyId: existing.balance.counterpartyId,
    metadata: { ...existing.metadata, serviceStart: existing.metadata.serviceStart.slice(0, 10),
      serviceEnd: existing.metadata.serviceEnd.slice(0, 10), scheduledReversalOn: existing.metadata.scheduledReversalOn?.slice(0, 10) ?? null },
  } : {
    sourceReference: '', accountingDate: '', amount: '', recognitionAccountId: '', balanceAccountId: '', counterpartyId: null,
    metadata: { kind: 'ACCRUED_EXPENSE', serviceStart: '', serviceEnd: '', supportingEvidence: '', recognitionBasis: '',
      policyReference: '', scheduledReversalOn: null },
  });
  const { metadata } = form;
  const [reversal, setReversal] = useState(metadata.scheduledReversalOn !== null);
  const [hasParty, setHasParty] = useState(Boolean(form.counterpartyId));
  const expense = metadata.kind === 'ACCRUED_EXPENSE';
  const rows = (accounts.read.data?.rows ?? []).filter(row => !row.contraFlag);
  const update = (value: Partial<AccrualInput>) => setForm({ ...form, ...value });
  const updateMetadata = (value: Partial<AccrualInput['metadata']>) => update({ metadata: { ...metadata, ...value } });
  async function save() {
    const error = !form.sourceReference.trim() || !positiveAmount(form.amount) ? 'Enter a reference and a positive amount with up to two decimal places.'
      : ![form.accountingDate, metadata.serviceStart, metadata.serviceEnd].every(validDay) || metadata.serviceStart > metadata.serviceEnd || form.accountingDate < metadata.serviceStart
        ? 'Enter a valid service period and an accounting date on or after its start.'
        : !routeId(form.recognitionAccountId) || !routeId(form.balanceAccountId) || form.recognitionAccountId === form.balanceAccountId
          ? 'Select two distinct posting accounts.'
          : [metadata.supportingEvidence, metadata.recognitionBasis, metadata.policyReference].some(value => value.trim().length < 10)
            ? 'Provide evidence, recognition basis, and policy reference with at least 10 characters each.'
            : hasParty && !routeId(form.counterpartyId ?? '') ? 'Select a counterparty or clear the option.'
              : reversal && (!validDay(metadata.scheduledReversalOn ?? '') || (metadata.scheduledReversalOn ?? '') < form.accountingDate)
                ? 'The planned reversal must be on or after the accounting date.' : '';
    setIssue(error);
    if (error) return;
    const result = await mutation.run(() => saveAccrual({ ...form, sourceReference: form.sourceReference.trim(),
      counterpartyId: hasParty ? form.counterpartyId : null, metadata: { ...metadata, scheduledReversalOn: reversal ? metadata.scheduledReversalOn : null } },
    existing && { id: existing.id, revision: existing.revision }), 'Accrual draft saved.');
    if (result) {
      if (onSaved) onSaved();
      else router.push('/accounting/accruals/' + result.id);
    }
  }
  return <form className={styles.page} noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
    <CoreFeedback error={issue || mutation.error} message={mutation.message} />
    <fieldset className={styles.page} disabled={mutation.busy}>
      <div className={styles.formGrid}>
        <ChoiceField label="Accrual kind" value={metadata.kind} disabled={!!existing} onChange={value => {
          if (value !== 'ACCRUED_EXPENSE' && value !== 'ACCRUED_INCOME') return;
          update({ recognitionAccountId: '', balanceAccountId: '', counterpartyId: null, metadata: { ...metadata, kind: value } });
        }} choices={[{ id: 'ACCRUED_EXPENSE', label: 'Accrued expense' }, { id: 'ACCRUED_INCOME', label: 'Accrued income' }]} />
        <CoreInput label="Source reference" value={form.sourceReference} maxLength={110} onChange={event => update({ sourceReference: event.target.value })} />
        <CoreInput label={expense ? 'Accounting date' : 'Recognition date'} type="date" value={form.accountingDate} onChange={event => update({ accountingDate: event.target.value })} />
        <CoreInput label="Service start" type="date" value={metadata.serviceStart} onChange={event => updateMetadata({ serviceStart: event.target.value })} />
        <CoreInput label="Service end" type="date" value={metadata.serviceEnd} onChange={event => updateMetadata({ serviceEnd: event.target.value })} />
        <MoneyField label="Accrual amount" value={form.amount} onChange={amount => update({ amount })} />
      </div>
      <AccountLookupSearch lookup={accounts} />
      <div className={styles.formGrid}>
        <CoreField label={expense ? 'Expense account' : 'Revenue account'}><AccountSelect label={expense ? 'Expense account' : 'Revenue account'} mode="posting"
          value={form.recognitionAccountId} rows={rows.filter(row => row.accountType === (expense ? 'EXPENSE' : 'REVENUE'))} onChange={recognitionAccountId => update({ recognitionAccountId })} /></CoreField>
        <CoreField label={expense ? 'Accrued liability account' : 'Accrued asset account'}><AccountSelect label={expense ? 'Accrued liability account' : 'Accrued asset account'} mode="posting"
          value={form.balanceAccountId} rows={rows.filter(row => row.accountType === (expense ? 'LIABILITY' : 'ASSET'))} onChange={balanceAccountId => update({ balanceAccountId })} /></CoreField>
      </div>
      <label><input type="checkbox" checked={hasParty} onChange={event => setHasParty(event.target.checked)} /> Link a counterparty</label>
      {hasParty ? <PartyChoice side={expense ? 'ap' : 'ar'} value={form.counterpartyId ?? ''} onChange={counterpartyId => update({ counterpartyId })} required /> : null}
      {!expense ? <p className={styles.warning}>REVIEW_REQUIRED · Document an earned right to income. Campaign targets, TIME_BASED commitments, and donation pledges do not qualify on their own.</p> : null}
      <TextArea label={expense ? 'Supporting evidence' : 'Recognition evidence'} minLength={10} maxLength={1000} value={metadata.supportingEvidence} onChange={supportingEvidence => updateMetadata({ supportingEvidence })} />
      <TextArea label="Recognition basis" minLength={10} maxLength={1000} value={metadata.recognitionBasis} onChange={recognitionBasis => updateMetadata({ recognitionBasis })} />
      <TextArea label="Policy reference" minLength={10} maxLength={1000} value={metadata.policyReference} onChange={policyReference => updateMetadata({ policyReference })} />
      <label><input type="checkbox" checked={reversal} onChange={event => setReversal(event.target.checked)} /> Opt in to scheduled reversal</label>
      {reversal ? <CoreInput label="Planned reversal date" type="date" value={metadata.scheduledReversalOn ?? ''} onChange={event => updateMetadata({ scheduledReversalOn: event.target.value || null })} /> : null}
      <p className={styles.note}>Saving a draft does not request approval, post, or schedule automatic execution.</p>
      <div><Button type="submit" disabled={mutation.busy}>{mutation.busy ? 'Saving…' : 'Save accrual draft'}</Button></div>
    </fieldset>
  </form>;
}
