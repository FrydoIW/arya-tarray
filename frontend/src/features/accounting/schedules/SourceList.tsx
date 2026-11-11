'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ChoiceField } from '../apar/fields';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { coreQuery } from '../core/api';
import { CoreInput, CorePagination, CoreReadState, CoreTable } from '../core/CoreUI';
import { useCoreRead } from '../core/hooks';
import type { AccountingPage } from '../types';
import styles from '../core/core.module.css';

export function SourceList<T extends { id: string; status: string }>({ path, title, kinds, kindOf, referenceOf, dateOf }: {
  path: 'accruals' | 'schedules'; title: string; kinds: { id: string; label: string }[];
  kindOf: (row: T) => string; referenceOf: (row: T) => string; dateOf: (row: T) => string;
}) {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const read = useCoreRead<AccountingPage<T>>(path + '?' + coreQuery({ page, pageSize: 25 }));
  const all = read.data?.rows ?? [];
  const rows = all.filter(row => (!kind || kindOf(row) === kind) && (!status || row.status === status)
    && referenceOf(row).toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    <div className={styles.toolbar}>
      <CoreInput label="Find reference on this page" value={search} onChange={event => setSearch(event.target.value)} />
      <ChoiceField label="Kind" value={kind} onChange={setKind} choices={kinds} empty="All kinds" />
      <ChoiceField label="Status" value={status} onChange={setStatus} choices={Array.from(new Set(all.map(row => row.status))).map(id => ({ id, label: id }))} empty="All statuses" />
      <Button variant="outline" disabled={read.loading} onClick={read.refresh}>Refresh records</Button>
    </div>
    <p className={styles.note}>Reference, kind, and status filters apply to the current server page.</p>
    <CoreReadState read={read} empty={!rows.length} />
    {read.data && !read.loading && !read.error ? <>
      {rows.length ? <CoreTable label={title} headers={['Reference', 'Kind', 'Date', 'Status']}>
        {rows.map(row => <tr key={row.id}>
          <td><Link className={styles.link} href={'/accounting/' + path + '/' + row.id}>{referenceOf(row)}</Link></td>
          <td>{kinds.find(item => item.id === kindOf(row))?.label ?? kindOf(row)}</td>
          <td>{dateOf(row).slice(0, 10)}</td><td><AccountingStatusIndicator status={row.status} /></td>
        </tr>)}
      </CoreTable> : null}
      <CorePagination {...read.data} loading={read.loading} onPage={setPage} />
    </> : null}
  </>;
}
