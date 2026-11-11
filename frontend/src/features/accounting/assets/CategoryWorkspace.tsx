'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import { ChoiceField, MoneyField, TextArea } from '../apar/fields';
import { AccountLookupSearch, AccountSelect, useAccountLookup } from '../core/AccountLookup';
import { coreQuery } from '../core/api';
import { CoreCard, CoreFeedback, CoreField, CoreInput, CorePage, CorePagination, CoreReadState, CoreTable } from '../core/CoreUI';
import { journalPermissions } from '../core/contracts.generated';
import { useCoreMutation, useCoreRead } from '../core/hooks';
import { accountingMoney } from '../core/presentation';
import { routeId } from '../core/route-scope';
import type { AccountingAccount, AccountingPage } from '../types';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import styles from '../core/core.module.css';
import { saveCategory } from './api';
import { AssetLinks, categoryHref, moneyInput, validLife } from './AssetUI';
import { partialMonths, type Category, type CategoryInput, type Policy } from './types';

const mappings = [
  ['assetAccountId', 'Asset cost account', 'ASSET', 'DEBIT', false, true],
  ['accumulatedDepreciationAccountId', 'Accumulated depreciation account', 'ASSET', 'CREDIT', true, true],
  ['depreciationExpenseAccountId', 'Depreciation expense account', 'EXPENSE', 'DEBIT', false, true],
  ['gainAccountId', 'Disposal gain account', 'REVENUE', 'CREDIT', false, false],
  ['lossAccountId', 'Disposal loss account', 'EXPENSE', 'DEBIT', false, false],
  ['impairmentExpenseAccountId', 'Impairment expense account', 'EXPENSE', 'DEBIT', false, false],
  ['impairmentAllowanceAccountId', 'Impairment allowance account', 'ASSET', 'CREDIT', true, false],
  ['disposalClearingAccountId', 'Disposal clearing account', 'LIABILITY', 'CREDIT', false, false],
] as const;
const blank: CategoryInput = {
  categoryCode: '', categoryName: '', assetAccountId: '', accumulatedDepreciationAccountId: '', depreciationExpenseAccountId: '',
  gainAccountId: null, lossAccountId: null, impairmentExpenseAccountId: null, impairmentAllowanceAccountId: null, disposalClearingAccountId: null,
  defaultUsefulLifeMonths: 0, defaultMethod: 'STRAIGHT_LINE', activeFlag: true, policy: null,
};

export function CategoryEvidence({ category }: { category: Category }) {
  const policy = category.policy;
  return <dl className={styles.details}>
    <dt>Default life / method</dt><dd>{category.defaultUsefulLifeMonths} months · {category.defaultMethod}</dd>
    {mappings.map(([key, label]) => <MappingEvidence key={key} label={label} id={category[key]} />)}
    <dt>Capitalization policy</dt><dd>{policy ? policy.policyReference : <AccountingStatusIndicator status="PENDING_POLICY" />}</dd>
    {policy ? <><dt>Threshold / partial-month convention</dt><dd>{accountingMoney(policy.capitalizationThreshold)} · {policy.partialMonthPolicy}</dd>
      <dt>Impairment policy</dt><dd>{policy.impairmentEnabled ? policy.impairmentPolicyReference ?? 'Reference unavailable' : 'Disabled in category policy'}</dd></> : null}
  </dl>;
}
function MappingEvidence({ label, id }: { label: string; id: string | null }) {
  return <><dt>{label}</dt><dd>{id ? <Link className={styles.link} href={'/accounting/general-ledger?accountId=' + id}>{id}</Link> : 'Unmapped'}</dd></>;
}

function CategoryForm({ category, onSaved }: { category?: Category; onSaved: (id: string) => void }) {
  const lookup = useAccountLookup(), mutation = useCoreMutation();
  const [form, setForm] = useState<CategoryInput>(() => {
    if (!category) return blank;
    const input = { ...blank };
    for (const [key] of mappings) Object.assign(input, { [key]: category[key] });
    return { ...input, categoryCode: category.categoryCode, categoryName: category.categoryName,
      defaultUsefulLifeMonths: category.defaultUsefulLifeMonths, activeFlag: category.activeFlag, policy: category.policy };
  });
  const [life, setLife] = useState(category ? String(category.defaultUsefulLifeMonths) : '');
  const [includePolicy, setIncludePolicy] = useState(!!category?.policy);
  const [policy, setPolicy] = useState<Omit<Policy, 'partialMonthPolicy'> & { partialMonthPolicy: Policy['partialMonthPolicy'] | '' }>(
    category?.policy ?? { policyReference: '', capitalizationThreshold: '', partialMonthPolicy: '', impairmentEnabled: false, impairmentPolicyReference: null });
  const [issue, setIssue] = useState('');
  const rows = lookup.read.data?.rows ?? [];
  const update = (value: Partial<CategoryInput>) => setForm({ ...form, ...value });
  const updatePolicy = (value: Partial<typeof policy>) => setPolicy({ ...policy, ...value });
  async function save() {
    const errors = !form.categoryCode.trim() || !form.categoryName.trim() || !validLife(life) ? 'Enter a code, name and useful life from 1 to 600 months.'
      : mappings.some(([key, , , , , required]) => required && !routeId(form[key] ?? '')) ? 'Select the required active posting mappings.'
        : form.accumulatedDepreciationAccountId === form.impairmentAllowanceAccountId ? 'Use distinct accumulated depreciation and impairment allowance accounts.'
          : includePolicy && (policy.policyReference.trim().length < 10 || !moneyInput(policy.capitalizationThreshold) || !policy.partialMonthPolicy
            || policy.impairmentEnabled && (policy.impairmentPolicyReference?.trim().length ?? 0) < 10)
            ? 'Enter the adopted policy reference, exact threshold and partial-month convention. Include an impairment reference if enabled.' : '';
    setIssue(errors);
    if (errors) return;
    const policyInput = includePolicy && policy.partialMonthPolicy ? {
      ...policy, partialMonthPolicy: policy.partialMonthPolicy, impairmentPolicyReference: policy.impairmentEnabled ? policy.impairmentPolicyReference : null,
    } : null;
    const saved = await mutation.run(() => saveCategory({ ...form, defaultUsefulLifeMonths: Number(life), policy: policyInput }, category), 'Category saved.');
    if (saved) onSaved(saved.id);
  }
  return <form className={styles.page} noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
    <CoreFeedback error={issue || mutation.error} message={mutation.message} />
    <fieldset className={styles.page} disabled={mutation.busy}>
      <div className={styles.formGrid}>
        <CoreInput label="Category code" maxLength={40} value={form.categoryCode} onChange={event => update({ categoryCode: event.target.value })} />
        <CoreInput label="Category name" maxLength={150} value={form.categoryName} onChange={event => update({ categoryName: event.target.value })} />
        <CoreInput label="Default useful life (months)" inputMode="numeric" maxLength={3} value={life} onChange={event => setLife(event.target.value)} />
      </div>
      <p className={styles.note}>Depreciation method · STRAIGHT_LINE</p>
      <label><input type="checkbox" checked={form.activeFlag} onChange={event => update({ activeFlag: event.target.checked })} /> Active category</label>
      <AccountLookupSearch lookup={lookup} />
      <div className={styles.formGrid}>{mappings.map(([key, label, type, balance, contra, required]) => {
        const eligible = rows.filter((row: AccountingAccount) => row.accountType === type && row.normalBalance === balance && row.contraFlag === contra);
        return <CoreField key={key} label={label + (required ? ' (required)' : '')}><AccountSelect label={label} mode="posting"
          value={form[key] ?? ''} onChange={value => update({ [key]: value || (required ? '' : null) })} rows={eligible} /></CoreField>;
      })}</div>
      <label><input type="checkbox" checked={includePolicy} onChange={event => setIncludePolicy(event.target.checked)} /> Supply an adopted policy</label>
      {includePolicy ? <>
        <TextArea label="Adopted capitalization policy reference" value={policy.policyReference} maxLength={1000} onChange={policyReference => updatePolicy({ policyReference })} />
        <div className={styles.formGrid}>
          <MoneyField label="Capitalization threshold" value={policy.capitalizationThreshold} onChange={capitalizationThreshold => updatePolicy({ capitalizationThreshold })} />
          <ChoiceField label="Partial-month convention" value={policy.partialMonthPolicy} onChange={value => {
            if (value === '' || value === 'FULL_MONTH' || value === 'NEXT_MONTH' || value === 'ACTUAL_DAYS') updatePolicy({ partialMonthPolicy: value });
          }} choices={partialMonths.map(id => ({ id, label: id }))} />
        </div>
        <label><input type="checkbox" checked={policy.impairmentEnabled} onChange={event => updatePolicy({ impairmentEnabled: event.target.checked })} /> Impairment enabled by adopted policy</label>
        {policy.impairmentEnabled ? <TextArea label="Adopted impairment policy reference" value={policy.impairmentPolicyReference ?? ''} maxLength={1000}
          onChange={impairmentPolicyReference => updatePolicy({ impairmentPolicyReference })} /> : null}
      </> : <p className={styles.warning}>PENDING_POLICY · An explicit threshold and depreciation convention are required for activation.</p>}
      <div><Button type="submit" disabled={mutation.busy}>Save asset category</Button></div>
    </fieldset>
  </form>;
}

function CategoryList() {
  const [input, setInput] = useState(''), [scope, setScope] = useState({ search: '', page: 1 });
  const read = useCoreRead<AccountingPage<Category>>('asset-categories?' + coreQuery({ ...scope, pageSize: 25 }));
  return <>
    <form className={styles.toolbar} onSubmit={event => { event.preventDefault(); setScope({ search: input.trim(), page: 1 }); }}>
      <CoreInput label="Search categories" value={input} maxLength={100} onChange={event => setInput(event.target.value)} />
      <Button type="submit" variant="outline">Search</Button><Button variant="outline" disabled={read.loading} onClick={read.refresh}>Refresh categories</Button>
    </form>
    <CoreReadState read={read} empty={read.data?.rows.length === 0} />
    {read.data && !read.loading && !read.error ? <>
      <CoreTable label="Asset category list" headers={['Category', 'Default life', 'Method', 'Status', 'Policy']}>
        {read.data.rows.map(row => <tr key={row.id}><td><Link className={styles.link} href={categoryHref + '/' + row.id}>{row.categoryCode} · {row.categoryName}</Link></td>
          <td>{row.defaultUsefulLifeMonths} months</td><td>{row.defaultMethod}</td><td>{row.activeFlag ? 'Active' : 'Inactive'}</td>
          <td>{row.policy ? 'Policy reference supplied' : <AccountingStatusIndicator status="PENDING_POLICY" />}</td></tr>)}
      </CoreTable>
      <CorePagination {...read.data} loading={read.loading} onPage={page => setScope({ ...scope, page })} />
    </> : null}
  </>;
}

export function CategoryWorkspace({ id, create }: { id?: string; create?: boolean }) {
  const router = useRouter(), user = useAuthSession(), read = useCoreRead<Category>('asset-categories/' + id, !!id);
  const manage = user.menuCodes.includes(journalPermissions.manage);
  const [edit, setEdit] = useState(false), [saved, setSaved] = useState(false);
  return <CorePage title={create ? 'New asset category' : id ? 'Asset category detail' : 'Asset categories'}
    description="Chart of Accounts mappings and explicit policy evidence."
    actions={!id && !create && manage ? <Link className={styles.link} href={categoryHref + '/new'}>New asset category</Link> : undefined}>
    <AssetLinks /><CoreCard>
      {create ? manage ? <CategoryForm onSaved={value => router.push(categoryHref + '/' + value)} />
        : <p role="alert">Journal management permission is required.</p>
      : id ? <><CoreReadState read={read} /><CoreFeedback error="" message={saved ? 'Category revision saved.' : ''} />
        {read.data && !read.loading && !read.error ? <>
          <h2>{read.data.categoryCode} · {read.data.categoryName}</h2><CategoryEvidence category={read.data} />
          <p className={styles.note}>Categories referenced by assets or approval history are immutable. Use an approved reclassification to change a used mapping.</p>
          {manage ? <Button variant="outline" onClick={() => setEdit(!edit)}>{edit ? 'Close category editor' : 'Edit category'}</Button> : null}
          {manage && edit ? <CategoryForm key={read.data.revision} category={read.data} onSaved={() => { setSaved(true); setEdit(false); read.refresh(); }} /> : null}
        </> : null}</> : <CategoryList />}
    </CoreCard>
  </CorePage>;
}
