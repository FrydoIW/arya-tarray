'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Select } from '@/components/ui/Select';
import { SearchInput } from '@/components/ui/SearchInput';
import type { AccountingPage } from '../types';
import { coreQuery } from '../core/api';
import { CoreField, CoreInput, CorePagination, CoreReadState } from '../core/CoreUI';
import { useCoreRead } from '../core/hooks';
import { decimalCents } from '../core/presentation';
import { routeId } from '../core/route-scope';
import styles from '../core/core.module.css';
import type { Counterparty, Side } from './types';

export function positiveAmount(value: string) {
  const cents = /^\d{1,18}(\.\d{1,2})?$/.test(value) ? decimalCents(value) : null;
  return cents !== null && cents > BigInt(0) ? cents : null;
}

export function validDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

export function compatibleParty(row: Counterparty, side: Side) {
  return row.counterpartyType === 'BOTH' || row.counterpartyType === (side === 'ap' ? 'VENDOR' : 'DEBTOR');
}

export function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <CoreInput label={label} inputMode="decimal" placeholder="0.00" value={value}
    onChange={event => onChange(event.target.value)} required />;
}

export function TextArea({ label, value, onChange, maxLength, minLength = 1, required = true }: {
  label: string; value: string; onChange: (value: string) => void; maxLength: number; minLength?: number; required?: boolean;
}) {
  return <label className={styles.field}>
    <span>{label}</span>
    <textarea value={value} onChange={event => onChange(event.target.value)} maxLength={maxLength} minLength={minLength} required={required} />
  </label>;
}

export type Choice = { id: string; label: string; disabled?: boolean };
export function ChoiceField({ label, value, onChange, choices, empty = 'Select…', required = false, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; choices: Choice[];
  empty?: string; required?: boolean; disabled?: boolean;
}) {
  return <CoreField label={label}>
    <Select aria-label={label} value={value} required={required} disabled={disabled} onChange={e => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {value && !choices.some(item => item.id === value) ? <option value={value}>Selected · {value}</option> : null}
      {choices.map(item => <option key={item.id} value={item.id} disabled={item.disabled}>{item.label}</option>)}
    </Select>
  </CoreField>;
}

export function CatalogChoice<T extends { id: string }>({ path, label, value, onChange, choice, empty, required }: {
  path: string; label: string; value: string; onChange: (value: string) => void; choice: (row: T) => Choice;
  empty?: string; required?: boolean;
}) {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const read = useCoreRead<AccountingPage<T>>(path + '?' + coreQuery({ search, page, pageSize: 25 }));
  return <div className={styles.page}>
    <div className={styles.toolbar}>
      <SearchInput aria-label={'Find ' + label.toLowerCase()} value={input} maxLength={100} onChange={event => setInput(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); setSearch(input.trim()); setPage(1); }
        }} placeholder="Search, then press Enter" />
    </div>
    <ChoiceField label={label} value={value} onChange={onChange} choices={read.loading || read.error ? [] : (read.data?.rows ?? []).map(choice)} empty={empty} required={required} />
    <CoreReadState read={read} />
    {read.data && read.data.total > read.data.pageSize ? <CorePagination {...read.data} loading={read.loading} onPage={setPage} /> : null}
  </div>;
}

export function PartyChoice({ side, value, onChange, required = false }: {
  side: Side; value: string; onChange: (value: string) => void; required?: boolean;
}) {
  return <CatalogChoice<Counterparty> path="counterparties" label={side === 'ap' ? 'Vendor' : 'Debtor'}
    value={value} onChange={onChange} empty={required ? 'Select counterparty' : 'All counterparties'} required={required}
    choice={row => ({
      id: row.id, label: row.counterpartyCode + ' · ' + row.displayName + (row.activeFlag ? '' : ' (inactive)'),
      disabled: required && (!row.activeFlag || !compatibleParty(row, side))
    })} />;
}

export function JournalLink({ id }: { id?: string | null }) {
  return routeId(id ?? '') ? <Link className={styles.link} href={'/accounting/journals?journalId=' + id}>View journal</Link> : <span>—</span>;
}

export function ApprovalLink({ id, children = 'Open approval' }: { id: string; children?: ReactNode }) {
  return <Link className={styles.link} href={'/accounting/approvals?id=' + encodeURIComponent(id)}>{children}</Link>;
}
