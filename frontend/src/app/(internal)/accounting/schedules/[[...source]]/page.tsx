import { notFound } from 'next/navigation';
import { routeId } from '@/features/accounting/core/route-scope';
import { ScheduleWorkspace } from '@/features/accounting/schedules/ScheduleWorkspace';

export default async function SchedulesPage({ params, searchParams }: {
  params: Promise<{ source?: string[] }>;
  searchParams: Promise<{ journalId?: string | string[] }>;
}) {
  const [{ source = [] }, query] = await Promise.all([params, searchParams]);
  if (!source.length) return <ScheduleWorkspace />;
  const [first] = source;
  if (source.length === 1 && first === 'new') {
    const journalId = routeId(query.journalId);
    return <ScheduleWorkspace key={journalId} isNew journalId={journalId} />;
  }
  const id = routeId(first);
  if (id && source.length === 1) return <ScheduleWorkspace id={id} />;
  notFound();
}
