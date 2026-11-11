import { notFound } from 'next/navigation';
import { routeId } from '@/features/accounting/core/route-scope';
import { AccrualWorkspace } from '@/features/accounting/schedules/AccrualWorkspace';

export default async function AccrualPage({ params }: { params: Promise<{ source?: string[] }> }) {
  const { source = [] } = await params;
  const [first, second] = source;
  if (!source.length) return <AccrualWorkspace mode="list" />;
  if (source.length === 1 && first === 'new') return <AccrualWorkspace mode="new" />;
  if (source.length === 1 && first === 'reversals') return <AccrualWorkspace mode="reversals" />;
  const id = routeId(first);
  if (id && source.length === 1) return <AccrualWorkspace mode="detail" id={id} />;
  if (id && source.length === 2 && second === 'clearing') return <AccrualWorkspace mode="clearing" id={id} />;
  notFound();
}
