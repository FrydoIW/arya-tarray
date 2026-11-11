import { notFound } from 'next/navigation';
import { ClosingWorkspace } from '@/features/accounting/finalization/ClosingWorkspace';
import { routeId } from '@/features/accounting/core/route-scope';
export default async function ClosingDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ type?: string | string[] }> }) {
  const [{ id: raw }, query] = await Promise.all([params, searchParams]);
  const id = routeId(raw), type = Array.isArray(query.type) ? query.type[0] : query.type;
  if (!id || !['PERIOD', 'YEAR'].includes(type ?? '')) notFound();
  return <ClosingWorkspace initialScope={{ id, type: type as 'PERIOD' | 'YEAR' }} />;
}
