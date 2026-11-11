import { AparRoute, type AparRouteProps } from '@/features/accounting/apar/AparRoute';

export default function PayablesPage(props: AparRouteProps) {
  return <AparRoute {...props} side="ap" />;
}
