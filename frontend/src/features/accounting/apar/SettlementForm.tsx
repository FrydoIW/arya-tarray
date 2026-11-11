'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { currentBusinessDayValue } from '@/lib/business-time';
import type { AccountingOptions } from '../types';
import { AccountLookupSearch, AccountSelect, useAccountLookup } from '../core/AccountLookup';
import { coreQuery } from '../core/api';
import { CoreCard, CoreFeedback, CoreField, CoreInput, CorePage, CorePagination, CoreReadState, CoreTable } from '../core/CoreUI';
import { openDateReason, useFiscalYears } from '../core/FiscalScope';
import { useCoreMutation, useCoreRead } from '../core/hooks';
import { accountingMoney, centsDecimal, decimalCents } from '../core/presentation';
import { routeId } from '../core/route-scope';
import styles from '../core/core.module.css';
import { saveSettlement, subledgerHref } from './api';
import { BankEvidencePicker } from './BankEvidence';
import { ChoiceField, MoneyField, PartyChoice, positiveAmount, validDay } from './fields';
import { settlementName, SubledgerLinks } from './SubledgerLists';
import type { Outstanding, OutstandingRow, SettlementDetail, SettlementInput, Side } from './types';

function initialInput(existing?: SettlementDetail, counterpartyId = ''): SettlementInput {
  if (existing) return {
    counterpartyId: existing.counterpartyId, bankAccountId: existing.bankAccountId, bankGlAccountId: existing.bankGlAccountId,
    settlementReference: existing.settlementReference, sourceReference: existing.sourceReference,
    settlementDate: existing.settlementDate, amount: existing.amount, bankTransactionId: existing.bankTransactionId,
    allocations: existing.allocations.map(({ accountingDocumentId, allocatedAmount }) => ({ accountingDocumentId, allocatedAmount }))
  };
  return { counterpartyId, bankAccountId: '', bankGlAccountId: '', settlementReference: '', sourceReference: '',
    settlementDate: currentBusinessDayValue(), amount: '', bankTransactionId: null, allocations: [] };
}

export function SettlementForm({ side, existing, initialParty }: { side: Side; existing?: SettlementDetail; initialParty?: string }) {
  const [input, setInput] = useState(() => initialInput(existing, initialParty));
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<Record<string, OutstandingRow>>({});
  const mutation = useCoreMutation();
  const lookup = useAccountLookup();
  const fiscal = useFiscalYears();
  const options = useCoreRead<AccountingOptions>('options');
  const lookupEnabled = !!routeId(input.counterpartyId) && validDay(input.settlementDate);
  const read = useCoreRead<Outstanding>(side + '/outstanding?' + coreQuery({
    asOf: input.settlementDate, counterpartyId: input.counterpartyId, page, pageSize: 25
  }), lookupEnabled);
  const report = read.data?.asOf === input.settlementDate && read.data.counterpartyId === input.counterpartyId ? read.data : null;
  const candidates = (report?.rows ?? []).filter(row => (decimalCents(row.outstanding) ?? BigInt(0)) > BigInt(0));
  const byId = new Map(candidates.map(row => [row.id, row]));
  const known = (id: string) => byId.get(id) ?? chosen[id];
  const total = input.allocations.reduce((sum, row) => sum + (positiveAmount(row.allocatedAmount) ?? BigInt(0)), BigInt(0));
  const available = positiveAmount(input.amount);
  const period = openDateReason(fiscal.data, input.settlementDate);
  const accounts = (lookup.read.loading ? [] : lookup.read.data?.rows ?? []).filter(row =>
    row.accountType === 'ASSET' && row.normalBalance === 'DEBIT' && !row.contraFlag);
  const label = settlementName[side].toLowerCase();
  function set(change: Partial<SettlementInput> | ((current: SettlementInput) => Partial<SettlementInput>)) {
    setInput(current => ({ ...current, ...(typeof change === 'function' ? change(current) : change) }));
    setReview(false);
    setError('');
  }

  function changeScope(change: Partial<SettlementInput>) {
    set({ ...change, allocations: [], bankTransactionId: null });
    setChosen({});
    setPage(1);
  }
  function add(row: OutstandingRow) {
    if (input.allocations.length >= 100 || input.allocations.some(item => item.accountingDocumentId === row.id)) return;
    setChosen(current => ({ ...current, [row.id]: row }));
    set(current => current.allocations.some(item => item.accountingDocumentId === row.id)
      ? {} : { allocations: [...current.allocations, { accountingDocumentId: row.id, allocatedAmount: '' }] });
  }
  function validate() {
    if (!lookupEnabled || !routeId(input.bankAccountId) || !routeId(input.bankGlAccountId)) return 'Select a counterparty, settlement date, bank account and bank GL account.';
    if (period) return period;
    if (!input.settlementReference.trim() || !input.sourceReference.trim()) return 'Enter settlement and supporting references.';
    if (input.bankTransactionId && !routeId(input.bankTransactionId)) return 'Enter a valid imported bank transaction UUID.';
    if (available === null || !input.allocations.length) return 'Enter a positive amount and at least one allocation.';
    if (read.loading || read.error) return 'Refresh outstanding balances before saving.';
    for (const allocation of input.allocations) {
      const value = positiveAmount(allocation.allocatedAmount);
      if (value === null) return 'Every allocation must be positive and use at most two decimal places.';
      const balance = known(allocation.accountingDocumentId);
      const limit = balance ? decimalCents(balance.outstanding) : null;
      if (limit !== null && value > limit) return 'An allocation exceeds the displayed outstanding balance.';
    }
    if (total !== available) return 'Allocated total must equal the settlement amount exactly.';
    return '';
  }
  async function save() {
    const issue = validate();
    if (issue) { setError(issue); setReview(false); return; }
    const result = await mutation.run(() => saveSettlement(side, {
      ...input, settlementReference: input.settlementReference.trim(), sourceReference: input.sourceReference.trim()
    }, existing), 'Settlement draft saved.');
    if (result) setSaved(result.id);
  }

  return <CorePage title={(existing ? 'Edit ' : 'New ') + label} description="Record an evidenced settlement and allocate it to recognized documents.">
    <SubledgerLinks side={side} />
    <CoreCard>
      <CoreFeedback error={error || mutation.error} message={mutation.message} />
      {saved ? <Link className={styles.link} href={subledgerHref(side) + '/settlements/' + saved}>Open saved {label}</Link>
        : <form className={styles.page} onSubmit={event => { event.preventDefault(); const issue = validate(); setError(issue); setReview(!issue); }}>
          <fieldset className={styles.page} disabled={mutation.busy}>
            <PartyChoice side={side} value={input.counterpartyId} onChange={counterpartyId => changeScope({ counterpartyId })} required />
            <p className={styles.note}>Changing the counterparty or settlement date clears allocation selections. Enter IDR amounts with a decimal point and up to two decimal places.</p>
            <div className={styles.formGrid}>
              <CoreInput label="Settlement reference" required maxLength={100} value={input.settlementReference}
                onChange={event => set({ settlementReference: event.target.value })} />
              <CoreInput label="Supporting reference" required maxLength={255} value={input.sourceReference}
                onChange={event => set({ sourceReference: event.target.value })} />
              <CoreInput label="Settlement date" type="date" required value={input.settlementDate}
                onChange={event => changeScope({ settlementDate: event.target.value })} />
              <MoneyField label="Settlement amount" value={input.amount} onChange={amount => set({ amount, bankTransactionId: null })} />
              <ChoiceField label="Bank account" required choices={options.data?.banks ?? []} value={input.bankAccountId}
                onChange={bankAccountId => set({ bankAccountId, bankTransactionId: null })} />
              <CoreField label="Bank GL account">
                <AccountSelect label="Bank GL account" rows={accounts} value={input.bankGlAccountId} mode="posting"
                  onChange={bankGlAccountId => set({ bankGlAccountId })} />
              </CoreField>
            </div>
            <CoreReadState read={options} /><AccountLookupSearch lookup={lookup} /><CoreReadState read={fiscal} />
            {period ? <p className={styles.warning}>{period}</p> : null}
            <BankEvidencePicker side={side} bankAccountId={input.bankAccountId} amount={input.amount} date={input.settlementDate}
              value={input.bankTransactionId ?? ''} onChange={id => set({ bankTransactionId: id || null })} />
            <p className={styles.note}>An approved and posted settlement without a bank link will show AWAITING_STATEMENT.</p>
            <h2>Allocation candidates</h2>
            {!lookupEnabled ? <p className={styles.note}>Select a counterparty and settlement date to load outstanding documents.</p> : <>
              <CoreReadState read={read} empty={report?.rows.length === 0} />
              {report && !read.loading && !read.error ? <>
                <p className={styles.note}>Posted outstanding as of {report.asOf}. The backend rechecks live balances and chronology on save and posting.</p>
                <CoreTable label="Allocation candidates" headers={['Document', 'Due date', 'Outstanding', 'Select']}>
                  {candidates.map(row => <tr key={row.id}><td>{row.documentNumber}</td><td>{row.dueDate}</td>
                    <td>{accountingMoney(row.outstanding)}</td><td><Button size="sm" variant="outline"
                      disabled={input.allocations.length >= 100 || input.allocations.some(item => item.accountingDocumentId === row.id)}
                      onClick={() => add(row)}>Allocate to {row.documentNumber}</Button></td></tr>)}
                </CoreTable>
                {report.total > report.pageSize ? <CorePagination {...report} loading={read.loading} onPage={setPage} /> : null}
              </> : null}
            </>}
            <h2>Selected allocations</h2>
            {input.allocations.length ? <CoreTable label="Selected allocations" headers={['Document', 'Outstanding', 'Allocate amount', 'Action']}>
              {input.allocations.map(row => <tr key={row.accountingDocumentId}>
                <td>{known(row.accountingDocumentId)?.documentNumber ?? row.accountingDocumentId}</td>
                <td>{accountingMoney(known(row.accountingDocumentId)?.outstanding)}</td>
                <td><MoneyField label={'Allocate ' + (known(row.accountingDocumentId)?.documentNumber ?? row.accountingDocumentId)}
                  value={row.allocatedAmount} onChange={allocatedAmount => set(current => ({
                    allocations: current.allocations.map(item => item.accountingDocumentId === row.accountingDocumentId ? { ...item, allocatedAmount } : item)
                  }))} /></td>
                <td><Button variant="outline" size="sm" onClick={() => set({
                  allocations: input.allocations.filter(item => item.accountingDocumentId !== row.accountingDocumentId)
                })}>Remove allocation</Button></td>
              </tr>)}
            </CoreTable> : <p className={styles.note}>Choose at least one recognized document from the candidate list.</p>}
            <div className={styles.summary}>
              <span>Available {accountingMoney(input.amount || null)}</span>
              <span>Allocated {accountingMoney(centsDecimal(total))}</span>
              <strong>Remaining {available === null ? '—' : accountingMoney(centsDecimal(available - total))}</strong>
            </div>
          </fieldset>
          {review ? <>
            <p className={styles.warning}>Save a {label} draft for {accountingMoney(input.amount)} across {input.allocations.length} documents? Posting requires independent approval.</p>
            <Button disabled={mutation.busy} onClick={save}>Confirm save settlement</Button>
          </> : <Button type="submit" disabled={mutation.busy}>Review settlement</Button>}
        </form>}
    </CoreCard>
  </CorePage>;
}
