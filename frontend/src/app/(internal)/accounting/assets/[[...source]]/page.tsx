import { notFound } from 'next/navigation';
import { routeId } from '@/features/accounting/core/route-scope';
import { AssetWorkspace, ReconciliationWorkspace } from '@/features/accounting/assets/AssetWorkspace';
import { CategoryWorkspace } from '@/features/accounting/assets/CategoryWorkspace';
import { ChangeWorkspace } from '@/features/accounting/assets/ChangeWorkspace';
import { DepreciationWorkspace } from '@/features/accounting/assets/DepreciationWorkspace';

export default async function FixedAssetsPage({ params, searchParams }: {
  params: Promise<{ source?: string[] }>;
  searchParams: Promise<{ journalId?: string | string[] }>;
}) {
  const [{ source = [] }, query] = await Promise.all([params, searchParams]);
  const [first, second] = source, id = routeId(second);
  if (!source.length) return <AssetWorkspace />;
  if (first === 'categories' || first === 'depreciation') {
    if (source.length > 2 || second && second !== 'new' && !id) notFound();
    const View = first === 'categories' ? CategoryWorkspace : DepreciationWorkspace;
    return <View key={second ?? first} id={id || undefined} create={second === 'new'} />;
  }
  if (first === 'changes' && source.length === 2 && id) return <ChangeWorkspace key={id} id={id} />;
  if (source.length !== 1) notFound();
  if (first === 'reconciliation') return <ReconciliationWorkspace />;
  if (first === 'new') return <AssetWorkspace key={query.journalId?.toString() ?? 'new'} create journalId={routeId(query.journalId)} />;
  if (routeId(first)) return <AssetWorkspace key={first} id={first} />;
  notFound();
}
