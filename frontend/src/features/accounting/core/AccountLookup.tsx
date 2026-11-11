"use client";
import { useEffect, useState } from 'react';
import { Select } from '@/components/ui/Select';
import { SearchInput } from '@/components/ui/SearchInput';
import type { AccountingAccount, AccountingPage } from '../types';
import { coreQuery } from './api';
import { useCoreRead } from './hooks';
import { CorePagination, CoreReadState } from './CoreUI';
import styles from './core.module.css';

export function useAccountLookup() {
  const [search, setSearch] = useState(''), [debounced, setDebounced] = useState(''), [page, setPage] = useState(1);
  useEffect(() => { const timer = setTimeout(() => { setDebounced(search); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const read = useCoreRead<AccountingPage<AccountingAccount>>(`coa?${coreQuery({ search: debounced, page, pageSize: 25 })}`);
  return { read, search, setSearch, page, setPage };
}
export function AccountLookupSearch({ lookup }: { lookup: ReturnType<typeof useAccountLookup> }) {
  return <div className={styles.toolbar}><SearchInput aria-label="Find accounts" placeholder="Find account code or name" value={lookup.search} onChange={e => lookup.setSearch(e.target.value)} /><CoreReadState read={lookup.read} />{lookup.read.data ? <CorePagination {...lookup.read.data} loading={lookup.read.loading} onPage={lookup.setPage} /> : null}</div>;
}
export function AccountSelect({ label, value, onChange, rows, mode = 'all', disabled = false }: { label: string; value: string; onChange: (value: string) => void; rows: AccountingAccount[]; mode?: 'all' | 'posting' | 'header'; disabled?: boolean }) {
  return <Select aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
    <option value="">{mode === 'posting' ? 'Select posting account' : mode === 'header' ? 'No parent' : 'All accounts'}</option>
    {value && !rows.some(row => row.id === value) ? <option value={value}>Selected account · {value}</option> : null}
    {rows.map(row => <option key={row.id} value={row.id} disabled={mode === 'posting' ? !row.activeFlag || !row.postingFlag : mode === 'header' ? !row.activeFlag || row.postingFlag : false}>{row.code} · {row.name}{row.activeFlag ? '' : ' (inactive)'}{row.postingFlag ? '' : ' (header)'}</option>)}
  </Select>;
}
