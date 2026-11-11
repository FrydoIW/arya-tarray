'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable/DataTable';
import { Modal } from '@/components/ui/Modal';
import { SearchInput } from '@/components/ui/SearchInput';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import type { AccountingPage } from '../types';
import { coreQuery } from '../core/api';
import { CoreCard, CoreFeedback, CoreInput, CorePage, CoreReadState } from '../core/CoreUI';
import { useCoreMutation, useCoreRead, useCoreSelection } from '../core/hooks';
import { routeId } from '../core/route-scope';
import styles from '../core/core.module.css';
import { editCounterparty, managementGrant, saveCounterparty } from './api';
import { ChoiceField } from './fields';
import type { Counterparty, CounterpartyInput, CounterpartyType } from './types';

const classifications = ['VENDOR', 'DEBTOR', 'BOTH'] as const;
function CounterpartyForm({ existing, onClose, onSaved }: { existing?: Counterparty; onClose: () => void; onSaved: () => void }) {
  const [input, setInput] = useState<CounterpartyInput>(existing ? {
    counterpartyCode: existing.counterpartyCode, displayName: existing.displayName,
    counterpartyType: existing.counterpartyType, memberId: existing.memberId, activeFlag: existing.activeFlag
  } : { counterpartyCode: '', displayName: '', counterpartyType: 'BOTH', memberId: null, activeFlag: true });
  const mutation = useCoreMutation();
  const [confirm, setConfirm] = useState(false);
  const [validation, setValidation] = useState('');
  const set = (change: Partial<CounterpartyInput>) => { setInput(current => ({ ...current, ...change })); setConfirm(false); };

  function review() {
    if (!input.displayName.trim() || !input.counterpartyCode.trim() || (input.memberId && !routeId(input.memberId))) {
      setValidation('Enter the code, name and a valid existing Member UUID if linking a Member.');
      return;
    }
    setValidation('');
    setConfirm(true);
  }
  async function save() {
    const displayName = input.displayName.trim();
    const saved = await mutation.run(() => existing
      ? editCounterparty(existing.id, { displayName, activeFlag: input.activeFlag })
      : saveCounterparty({ ...input, counterpartyCode: input.counterpartyCode.trim(), displayName }), 'Counterparty saved.');
    if (saved) onSaved();
  }

  return <Modal open title={existing ? 'Edit counterparty' : 'New counterparty'} onClose={() => { if (!mutation.busy) onClose(); }}>
    <form className={styles.modal} onSubmit={event => { event.preventDefault(); review(); }}>
      <CoreFeedback error={validation || mutation.error} message={mutation.message} />
      <fieldset className={styles.formGrid} disabled={mutation.busy}>
        <CoreInput label="Counterparty code" required maxLength={40} disabled={!!existing} value={input.counterpartyCode} onChange={event => set({ counterpartyCode: event.target.value })} />
        <CoreInput label="Display name" required maxLength={200} value={input.displayName} onChange={event => set({ displayName: event.target.value })} />
        <ChoiceField label="Classification" choices={classifications.map(id => ({ id, label: id }))} value={input.counterpartyType} disabled={!!existing}
          required onChange={value => set({ counterpartyType: value as CounterpartyType })} />
        <CoreInput label="Existing Member ID (optional)" maxLength={36} disabled={!!existing} value={input.memberId ?? ''}
          onChange={event => set({ memberId: event.target.value.trim() || null })} />
        <label className={styles.check}><input type="checkbox" checked={input.activeFlag} onChange={event => set({ activeFlag: event.target.checked })} />Active</label>
      </fieldset>
      <p className={styles.note}>The optional Member ID links an existing record. Vendor and debtor activity may share the same counterparty.</p>
      {confirm ? <p className={styles.warning}>Save {input.displayName} as {input.activeFlag ? 'active' : 'inactive'}?</p> : null}
      {confirm ? <Button disabled={mutation.busy} onClick={save}>Confirm counterparty</Button>
        : <Button type="submit" disabled={mutation.busy}>Review counterparty</Button>}
    </form>
  </Modal>;
}

export function CounterpartyWorkspace({ id }: { id: string }) {
  const user = useAuthSession();
  const canManage = Object.values(managementGrant).some(code => user.menuCodes.includes(code));
  const [filters, setFilters] = useCoreSelection('counterparties', { search: '', page: 1 });
  const [search, setSearch] = useState(filters.search);
  const [form, setForm] = useState(false);
  const [saved, setSaved] = useState(false);
  const list = useCoreRead<AccountingPage<Counterparty>>('counterparties?' + coreQuery({ ...filters, pageSize: 25 }), !id);
  const detail = useCoreRead<Counterparty>('counterparties/' + id, !!id);
  const read = id ? detail : list;
  const row = detail.data;
  return <CorePage title="Counterparties" description="Shared vendor and debtor directory."
    actions={<><Button variant="outline" onClick={read.refresh} disabled={read.loading}>Refresh</Button>
      {canManage && (!id || (row && !read.loading)) ? <Button onClick={() => { setSaved(false); setForm(true); }}>{id ? 'Edit counterparty' : 'New counterparty'}</Button> : null}</>}>
    <CoreFeedback error="" message={saved ? 'Counterparty saved.' : ''} />
    <CoreCard>
      {id ? <Link className={styles.link} href="/accounting/counterparties">All counterparties</Link> : <form className={styles.toolbar} onSubmit={event => {
        event.preventDefault(); setFilters({ search: search.trim(), page: 1 });
      }}>
        <SearchInput aria-label="Counterparty code or name" value={search} maxLength={100} onChange={event => setSearch(event.target.value)} />
        <Button type="submit" variant="outline">Search</Button>
      </form>}
      <CoreReadState read={read} />
      {id && row && !read.loading && !read.error ? <>
        <h2>{row.counterpartyCode} · {row.displayName}</h2>
        <dl className={styles.details}><dt>Classification</dt><dd>{row.counterpartyType}</dd>
          <dt>Active</dt><dd>{row.activeFlag ? 'Yes' : 'No'}</dd><dt>Member reference</dt><dd>{row.memberId ?? 'None'}</dd></dl>
        <div className={styles.toolbar}>
          <Link className={styles.link} href={'/accounting/payables?counterpartyId=' + row.id}>Related AP documents</Link>
          <Link className={styles.link} href={'/accounting/receivables?counterpartyId=' + row.id}>Related AR documents</Link>
        </div>
      </> : null}
      {!id && list.data && !read.loading && !read.error ? <DataTable ariaLabel="Counterparties" rows={list.data.rows} rowKey={item => item.id} minWidth="540px"
        columns={[
          { key: 'counterpartyCode', header: 'Code' },
          { key: 'displayName', header: 'Name', render: item => <Link className={styles.link} href={'/accounting/counterparties?id=' + item.id}>{item.displayName}</Link> },
          { key: 'counterpartyType', header: 'Classification' },
          { key: 'activeFlag', header: 'Active' }
        ]} pagination={{ ...list.data, mode: 'server', onPageChange: page => setFilters({ ...filters, page }) }} /> : null}
    </CoreCard>
    {form && canManage ? <CounterpartyForm existing={id ? row ?? undefined : undefined} onClose={() => setForm(false)}
      onSaved={() => { setForm(false); setSaved(true); read.refresh(); }} /> : null}
  </CorePage>;
}
