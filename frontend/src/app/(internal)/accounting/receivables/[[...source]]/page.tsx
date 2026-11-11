import { AparRoute, type AparRouteProps } from '@/features/accounting/apar/AparRoute';

export default function ReceivablesPage(props: AparRouteProps) {
  return <AparRoute {...props} side="ar" />;
}
