'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { currentBusinessDayValue } from '@/lib/business-time';
import type { AccountingOptions, AccountingPage } from '../types';
import { AccountLookupSearch, AccountSelect, useAccountLookup } from '../core/AccountLookup';
import { CoreCard, CoreFeedback, CoreField, CoreInput, CorePage, CorePagination, CoreReadState, CoreTable } from '../core/CoreUI';
import { useCoreMutation, useCoreRead } from '../core/hooks';
import { accountingMoney, centsDecimal } from '../core/presentation';
import { routeId } from '../core/route-scope';
import styles from '../core/core.module.css';
import { saveDocument, subledgerHref } from './api';
import { ChoiceField, MoneyField, PartyChoice, positiveAmount, TextArea, validDay } from './fields';
import { SubledgerLinks, subledgerName } from './SubledgerLists';
import type { DocumentDetail, DocumentInput, DocumentLine, Side } from './types';

const blankLine: DocumentLine = { accountingAccountId: '', description: '', amount: '', accountingFundId: null, eventCampaignId: null };
type Fund = { id: string; fundCode: string; fundName: string; status: string; policyStatus: string };

function initialInput(existing?: DocumentDetail): DocumentInput {
  if (existing) return {
    accrualDraftId: existing.accrualDraftId, counterpartyId: existing.counterpartyId, controlAccountId: existing.controlAccountId,
    documentNumber: existing.documentNumber, sourceReference: existing.sourceReference, recognitionBasis: existing.recognitionBasis,
    documentDate: existing.documentDate, accountingDate: existing.accountingDate, dueDate: existing.dueDate,
    lines: existing.lines.map(({ accountingAccountId, description, amount, accountingFundId, eventCampaignId }) =>
      ({ accountingAccountId, description, amount, accountingFundId, eventCampaignId }))
  };
  const today = currentBusinessDayValue();
  return { accrualDraftId: null, counterpartyId: '', controlAccountId: '', documentNumber: '', sourceReference: '',
    recognitionBasis: '', documentDate: today, accountingDate: today, dueDate: today, lines: [{ ...blankLine }] };
}

export function DocumentForm({ side, existing }: { side: Side; existing?: DocumentDetail }) {
  const [input, setInput] = useState(() => initialInput(existing));
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [fundPage, setFundPage] = useState(1);
  const mutation = useCoreMutation();
  const lookup = useAccountLookup();
  const options = useCoreRead<AccountingOptions>('options');
  const funds = useCoreRead<AccountingPage<Fund>>('funds?pageSize=25&page=' + fundPage);
  const label = side === 'ap' ? 'invoice' : 'receivable';
  function set(change: Partial<DocumentInput> | ((current: DocumentInput) => Partial<DocumentInput>)) {
    setInput(current => ({ ...current, ...(typeof change === 'function' ? change(current) : change) }));
    setReview(false);
    setError('');
  }
  const setLine = (index: number, change: Partial<DocumentLine>) => set(current => ({
    lines: current.lines.map((line, i) => i === index ? { ...line, ...change } : line)
  }));
  const accounts = (lookup.read.loading ? [] : lookup.read.data?.rows ?? []).filter(row => !row.contraFlag);
  const control = accounts.filter(row => side === 'ap' ? row.accountType === 'LIABILITY' && row.normalBalance === 'CREDIT'
    : row.accountType === 'ASSET' && row.normalBalance === 'DEBIT');
  const offsets = accounts.filter(row => row.id !== input.controlAccountId && (existing?.accrualDraftId ||
    (side === 'ap' ? ['EXPENSE', 'ASSET'].includes(row.accountType) && row.normalBalance === 'DEBIT'
      : ['REVENUE', 'LIABILITY'].includes(row.accountType) && row.normalBalance === 'CREDIT')));
  const total = input.lines.reduce((sum, line) => sum + (positiveAmount(line.amount) ?? BigInt(0)), BigInt(0));
  function validate() {
    if (!routeId(input.counterpartyId) || !routeId(input.controlAccountId)) return 'Select a compatible counterparty and control account.';
    if (!input.documentNumber.trim() || !input.sourceReference.trim() || input.recognitionBasis.trim().length < 10) {
      return 'Enter the document number, supporting reference and at least 10 characters of evidence.';
    }
    if (![input.documentDate, input.accountingDate, input.dueDate].every(validDay) || input.dueDate < input.documentDate) {
      return 'Enter valid dates. The due date must be on or after the document date.';
    }
    if (input.lines.some(line => !routeId(line.accountingAccountId) || line.accountingAccountId === input.controlAccountId
      || !line.description.trim() || positiveAmount(line.amount) === null)) return 'Each line needs an offset account, description and positive exact amount.';
    if (positiveAmount(centsDecimal(total)) === null) return 'The total must fit an amount with 18 integer digits and two decimal places.';
    return '';
  }
  async function save() {
    const result = await mutation.run(() => saveDocument(side, {
      ...input, documentNumber: input.documentNumber.trim(), sourceReference: input.sourceReference.trim(),
      recognitionBasis: input.recognitionBasis.trim(), lines: input.lines.map(line => ({ ...line, description: line.description.trim() }))
    }, existing), 'Draft saved.');
    if (result) setSaved(result.id);
  }
  return <CorePage title={(existing ? 'Edit ' : 'New ') + label} description={subledgerName[side] + ' draft and supporting evidence.'}>
    <SubledgerLinks side={side} />
    <CoreCard>
      <CoreFeedback error={error || mutation.error} message={mutation.message} />
      {saved ? <Link className={styles.link} href={subledgerHref(side) + '/' + saved}>Open saved {label}</Link> : <form className={styles.page}
        onSubmit={event => { event.preventDefault(); const issue = validate(); setError(issue); setReview(!issue); }}>
        <fieldset className={styles.page} disabled={mutation.busy}>
          <PartyChoice side={side} value={input.counterpartyId} onChange={counterpartyId => set({ counterpartyId })} required />
          <div className={styles.formGrid}>
            <CoreInput label="Document number" required maxLength={100} value={input.documentNumber} onChange={event => set({ documentNumber: event.target.value })} />
            <CoreInput label="Supporting reference" required maxLength={255} value={input.sourceReference} onChange={event => set({ sourceReference: event.target.value })} />
            <CoreInput label="Document date" type="date" required value={input.documentDate} onChange={event => set({ documentDate: event.target.value })} />
            <CoreInput label={side === 'ap' ? 'Accounting date' : 'Recognition accounting date'} type="date" required value={input.accountingDate}
              onChange={event => set({ accountingDate: event.target.value })} />
            <CoreInput label="Due date" type="date" required min={input.documentDate} value={input.dueDate} onChange={event => set({ dueDate: event.target.value })} />
          </div>
          <TextArea label={side === 'ap' ? 'Invoice evidence and basis' : 'Recognition evidence and basis'} minLength={10} maxLength={1000}
            value={input.recognitionBasis} onChange={recognitionBasis => set({ recognitionBasis })} />
          {side === 'ar' ? <p className={styles.warning}>Describe the evidence for a present receivable. A campaign target, donation pledge or TIME_BASED subscription alone does not establish recognition.</p> : null}
          {existing?.accrualDraftId ? <p className={styles.note}>Existing accrual evidence · {existing.accrualDraftId}</p> : null}
          <AccountLookupSearch lookup={lookup} />
          <CoreField label="Control account">
            <AccountSelect label="Control account" value={input.controlAccountId} onChange={controlAccountId => set({ controlAccountId })} rows={control} mode="posting" />
          </CoreField>
          <CoreReadState read={options} /><CoreReadState read={funds} />
          {funds.data && funds.data.total > funds.data.pageSize ? <CorePagination {...funds.data} loading={funds.loading} onPage={setFundPage} /> : null}
          <p className={styles.note}>Enter IDR amounts with a decimal point and up to two decimal places.</p>
          <CoreTable label="Document lines" headers={['Offset account', 'Description', 'Amount', 'Fund', 'Program', 'Action']}>
            {input.lines.map((line, index) => <tr key={index}>
              <td><AccountSelect label={'Offset account ' + (index + 1)} value={line.accountingAccountId}
                onChange={accountingAccountId => setLine(index, { accountingAccountId })} rows={offsets} mode="posting" /></td>
              <td><CoreInput label={'Line description ' + (index + 1)} required maxLength={500} value={line.description}
                onChange={event => setLine(index, { description: event.target.value })} /></td>
              <td><MoneyField label={'Line amount ' + (index + 1)} value={line.amount} onChange={amount => setLine(index, { amount })} /></td>
              <td><ChoiceField label={'Fund ' + (index + 1)} empty="No fund" value={line.accountingFundId ?? ''}
                choices={(funds.data?.rows ?? []).map(row => ({ id: row.id, label: row.fundCode + ' · ' + row.fundName + ' · ' + row.policyStatus }))}
                onChange={id => setLine(index, { accountingFundId: id || null })} /></td>
              <td><ChoiceField label={'Program ' + (index + 1)} empty="No program" value={line.eventCampaignId ?? ''} choices={options.data?.campaigns ?? []}
                onChange={id => setLine(index, { eventCampaignId: id || null })} /></td>
              <td><Button variant="outline" size="sm" disabled={input.lines.length === 1}
                onClick={() => set({ lines: input.lines.filter((_, i) => i !== index) })}>Remove line {index + 1}</Button></td>
            </tr>)}
          </CoreTable>
          <div className={styles.actions}>
            <Button variant="outline" disabled={input.lines.length >= 200} onClick={() => set({ lines: [...input.lines, { ...blankLine }] })}>Add line</Button>
            <strong>Draft total {accountingMoney(centsDecimal(total))}</strong>
          </div>
        </fieldset>
        {review ? <>
          <p className={styles.warning}>Save draft {input.documentNumber} for {accountingMoney(centsDecimal(total))}? An independent approval and a separate posting action are required.</p>
          <Button disabled={mutation.busy} onClick={save}>Confirm save draft</Button>
        </> : <Button type="submit" disabled={mutation.busy}>Review draft</Button>}
      </form>}
    </CoreCard>
  </CorePage>;
}
