import type { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { openPeriodsForDate } from "../ledger/ledger.repository.js";

/** Shared posting gate for reconciliation and all other Accounting sources. */
export function selectOpenAccountingPeriodId(periods: readonly {
  id: string;
  status: string;
  relFkAccPeriodFy: { status: string };
}[]): string {
  if (periods.length !== 1 || periods[0]?.status !== "OPEN" || periods[0].relFkAccPeriodFy.status !== "OPEN") {
    throw new HttpError(409, "Exactly one open accounting period and fiscal year must cover the journal date.");
  }
  return periods[0].id;
}

export async function requireOpenAccountingPeriod(tx: Prisma.TransactionClient, accountingDate: Date): Promise<string> {
  return selectOpenAccountingPeriodId(await openPeriodsForDate(tx, accountingDate));
}
