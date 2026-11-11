"use client";
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { SearchInput } from '@/components/ui/SearchInput';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import type { AccountingAccount, AccountingPage } from '../types';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { accountTypes, normalBalances } from './contracts.generated';
import { coreQuery, saveAccount } from './api';
import { useCoreMutation, useCoreRead, useCoreSelection } from './hooks';
import { AccountLookupSearch, AccountSelect, useAccountLookup } from './AccountLookup';
import { CoreCard, CoreFeedback, CoreField, CoreInput, CorePage, CorePagination, CorePolicyNote, CoreReadState, CoreTable } from './CoreUI';
import type { AccountInput } from './types';
import styles from './core.module.css';

function AccountForm({ account, onClose, onSaved }: { account: AccountingAccount | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AccountInput>(() => account ? { code: account.code, name: account.name, accountType: account.accountType, normalBalance: account.normalBalance, parentAccountId: account.parentAccountId, accountClassification: account.accountClassification, reportSection: account.reportSection, contraFlag: account.contraFlag, postingFlag: account.postingFlag, activeFlag: account.activeFlag } : { code: '', name: '', accountType: accountTypes[0], normalBalance: normalBalances[0], parentAccountId: null, accountClassification: null, reportSection: null, contraFlag: false, postingFlag: true, activeFlag: true });
  const mutation = useCoreMutation(), lookup = useAccountLookup(), [confirming, setConfirming] = useState(false), posted = Boolean(account?._count.lines);
  const update = <K extends keyof AccountInput>(key: K, value: AccountInput[K]) => { setForm(current => ({ ...current, [key]: value })); setConfirming(false); };
  async function save() {
    const { code: _code, accountType: _type, ...editable } = form;
    const result = await mutation.run(() => saveAccount(account?.id ?? null, account ? posted ? { activeFlag: form.activeFlag } : editable : form), 'Account saved.');
    if (result) onSaved();
  }
  return <Modal open title={account ? `Edit ${account.code}` : 'Create account'} description="Review the account classification and hierarchy. Existing posted history is preserved." onClose={() => { if (!mutation.busy) onClose(); }}><form className={styles.modal} onSubmit={e => { e.preventDefault(); setConfirming(true); }}>
    <CoreFeedback {...mutation} />{posted ? <p className={styles.warning}>This account has posted journal lines. Only activation status can be changed.</p> : null}
    <fieldset disabled={mutation.busy || posted} className={styles.formGrid}>
      <CoreInput label="Account code" required maxLength={10} pattern="[A-Za-z0-9.\-]+" value={form.code} disabled={!!account} onChange={e => update('code', e.target.value)} />
      <CoreInput label="Account name" required maxLength={150} value={form.name} onChange={e => update('name', e.target.value)} />
      <CoreField label="Account type"><Select aria-label="Account type" value={form.accountType} disabled={!!account} onChange={e => { const type = accountTypes.find(value => value === e.target.value); if (type) update('accountType', type); }}>{accountTypes.map(type => <option key={type}>{type}</option>)}</Select></CoreField>
      <CoreField label="Normal balance"><Select aria-label="Normal balance" value={form.normalBalance} onChange={e => { const value = normalBalances.find(item => item === e.target.value); if (value) update('normalBalance', value); }}>{normalBalances.map(type => <option key={type}>{type}</option>)}</Select></CoreField>
      <CoreInput label="Classification" maxLength={40} value={form.accountClassification ?? ''} onChange={e => update('accountClassification', e.target.value || null)} />
      <CoreInput label="Report section" maxLength={40} value={form.reportSection ?? ''} onChange={e => update('reportSection', e.target.value || null)} />
      <CoreField label="Parent account"><AccountSelect label="Parent account" mode="header" rows={(lookup.read.data?.rows ?? []).filter(row => row.id !== account?.id && row.accountType === form.accountType)} value={form.parentAccountId ?? ''} onChange={id => update('parentAccountId', id || null)} /></CoreField>
      <label className={styles.check}><input type="checkbox" checked={form.postingFlag} onChange={e => update('postingFlag', e.target.checked)} />Posting enabled</label>
      <label className={styles.check}><input type="checkbox" checked={form.contraFlag} onChange={e => update('contraFlag', e.target.checked)} />Contra account</label>
    </fieldset>
    {!posted ? <AccountLookupSearch lookup={lookup} /> : null}
    <label className={styles.check}><input type="checkbox" disabled={mutation.busy} checked={form.activeFlag} onChange={e => update('activeFlag', e.target.checked)} />Active account</label>
    {confirming ? <><p className={styles.warning}>Confirm {account ? 'updating' : 'creating'} account {form.code} · {form.name}. This changes the account configuration used by future Accounting operations; posted history will remain intact.</p><div className={styles.actions}><Button disabled={mutation.busy} onClick={() => void save()}>{mutation.busy ? 'Saving…' : 'Confirm save account'}</Button><Button variant="outline" disabled={mutation.busy} onClick={() => setConfirming(false)}>Back to form</Button></div></> : <Button type="submit" disabled={mutation.busy}>Review account changes</Button>}
  </form></Modal>;
}
export function CoaWorkspace() {
  const user = useAuthSession(), canManage = user.menuCodes.includes('ACCOUNTING_COA_MANAGE');
  const [filters, setFilters] = useCoreSelection('coa', { search: '', type: '', active: '', page: 1 }), [search, setSearch] = useState(filters.search);
  useEffect(() => { const timer = setTimeout(() => { if (search !== filters.search) setFilters({ ...filters, search, page: 1 }); }, 250); return () => clearTimeout(timer); }, [search, filters, setFilters]);
  const read = useCoreRead<AccountingPage<AccountingAccount>>(`coa?${coreQuery({ ...filters, pageSize: 25 })}`);
  const [detail, setDetail] = useState<AccountingAccount | null>(null), [editing, setEditing] = useState<AccountingAccount | null | undefined>(undefined), [message, setMessage] = useState('');
  return <CorePage title="Chart of Accounts" description="Account catalog, classifications and posting hierarchy." actions={<><Button variant="outline" onClick={read.refresh} disabled={read.loading}>Refresh</Button>{canManage ? <Button onClick={() => setEditing(null)}>Create account</Button> : null}</>}>
    <CorePolicyNote /><CoreFeedback error="" message={message} /><CoreCard><div className={styles.filters}>
      <SearchInput aria-label="Search accounts" value={search} onChange={e => setSearch(e.target.value)} placeholder="Account code or name" />
      <Select aria-label="Filter account type" value={filters.type} onChange={e => setFilters({ ...filters, type: e.target.value, page: 1 })}><option value="">All types</option>{accountTypes.map(type => <option key={type}>{type}</option>)}</Select>
      <Select aria-label="Filter active accounts" value={filters.active} onChange={e => setFilters({ ...filters, active: e.target.value, page: 1 })}><option value="">All statuses</option><option value="true">Active</option><option value="false">Inactive</option></Select>
    </div><CoreReadState read={read} empty={read.data?.rows.length === 0} />{read.data && !read.loading && !read.error ? <><CoreTable label="Chart of Accounts" headers={['Account', 'Type', 'Normal balance', 'Posting', 'Status', 'Posted lines', 'Actions']}>
      {read.data.rows.map(row => <tr key={row.id}><td>{row.code} · {row.name}</td><td>{row.accountType}</td><td>{row.normalBalance}</td><td>{row.postingFlag ? 'Posting' : 'Header'}</td><td>{row.activeFlag ? 'Active' : 'Inactive'}</td><td>{row._count.lines}</td><td><div className={styles.actions}><Button variant="ghost" size="sm" onClick={() => setDetail(row)}>Details {row.code}</Button>{canManage ? <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>Edit {row.code}</Button> : null}</div></td></tr>)}
    </CoreTable><CorePagination {...read.data} loading={read.loading} onPage={page => setFilters({ ...filters, page })} /></> : null}</CoreCard>
    <Modal open={!!detail} title={detail ? `${detail.code} · ${detail.name}` : 'Account detail'} onClose={() => setDetail(null)}>{detail ? <div className={styles.modal}>{[['Type', detail.accountType], ['Normal balance', detail.normalBalance], ['Parent account ID', detail.parentAccountId ?? 'None'], ['Classification', detail.accountClassification ?? 'Not configured'], ['Report section', detail.reportSection ?? 'Not configured'], ['Contra account', detail.contraFlag ? 'Yes' : 'No'], ['Posting enabled', detail.postingFlag ? 'Yes' : 'No'], ['Posted lines', detail._count.lines], ['Last updated', detail.updatedAt]].map(([label, value]) => <dl key={label} className={styles.details}><dt>{label}</dt><dd>{value}</dd></dl>)}<AccountingStatusIndicator status="NOT_EVALUATED" /></div> : null}</Modal>
    {editing !== undefined && canManage ? <AccountForm account={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); setDetail(null); setMessage('Account saved successfully.'); read.refresh(); }} /> : null}
  </CorePage>;
}
