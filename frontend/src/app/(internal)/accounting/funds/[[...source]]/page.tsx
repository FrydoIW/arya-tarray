import { notFound } from 'next/navigation';
import { routeId } from '@/features/accounting/core/route-scope';
import { FundWorkspace } from '@/features/accounting/funds/FundWorkspace';
import { RestrictionWorkspace } from '@/features/accounting/funds/RestrictionWorkspace';
import { DesignationWorkspace } from '@/features/accounting/funds/DesignationWorkspace';
import { MovementWorkspace } from '@/features/accounting/funds/MovementWorkspace';
import { ReconciliationWorkspace } from '@/features/accounting/funds/ReconciliationWorkspace';

export default async function FundsPage({ params, searchParams }: {
  params: Promise<{ source?: string[] }>;
  searchParams: Promise<{ fundId?: string | string[] }>;
}) {
  const [{ source = [] }, query] = await Promise.all([params, searchParams]);
  const fundId = routeId(query.fundId), [first, second] = source, id = routeId(second);
  if (!source.length) return <FundWorkspace />;
  if (first === 'restrictions' || first === 'designations' || first === 'movements') {
    if (source.length > 2 || second && second !== 'new' && !id) notFound();
    const View = first === 'restrictions' ? RestrictionWorkspace : first === 'designations' ? DesignationWorkspace : MovementWorkspace;
    return <View key={second ?? first} fundId={fundId || undefined} id={id || undefined} create={second === 'new'} />;
  }
  if (source.length !== 1) notFound();
  if (first === 'reconciliation') return <ReconciliationWorkspace fundId={fundId || undefined} />;
  if (first === 'new') return <FundWorkspace create />;
  if (routeId(first)) return <FundWorkspace id={first} />;
  notFound();
}
