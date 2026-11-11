import { ApprovalWorkspace } from '@/features/accounting/core/ApprovalWorkspace';
import { routeId } from '@/features/accounting/core/route-scope';
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const id = routeId((await searchParams).id);
  return <ApprovalWorkspace key={id} initialId={id} />;
}
