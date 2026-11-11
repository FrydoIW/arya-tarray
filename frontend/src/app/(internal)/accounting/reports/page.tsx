import { AccountingScreen } from "@/features/accounting/components/AccountingScreen";
import type { AccountingView } from "@/features/accounting/types";

function reportView(value: unknown): AccountingView | undefined {
  switch (value) { case "journals": case "ledger": case "trial": case "monthly": case "reconciliation": case "pending": return value; default: return undefined; }
}
export default async function AccountingReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams, filters: Record<string, string> = {};
  for (const key of ["from", "to", "bankAccountId", "eventCodeId", "eventCampaignId", "memberId", "eventType", "journalType", "journalNumber", "accountCode"]) {
    const value = params[key]; if (typeof value === "string") filters[key] = value;
  }
  const page = Number(params.page), initialPage = Number.isInteger(page) && page >= 1 && page <= 100000 ? page : undefined;
  return <AccountingScreen initialView={reportView(params.view)} initialFilters={filters} initialPage={initialPage} />;
}
