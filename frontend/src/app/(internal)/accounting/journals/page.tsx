import { JournalWorkspace } from '@/features/accounting/core/JournalWorkspace';
import { routeId } from '@/features/accounting/core/route-scope';
export default async function JournalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const id = routeId((await searchParams).journalId);
  return <JournalWorkspace key={id} initialJournalId={id} />;
}
