import { HttpError } from "../../../lib/http.js";
import { centsToDecimal } from "../../../lib/money.js";
import { accountingCents, accountingTotalCents } from "../accounting.domain.js";

export const AP_MANAGE = "ACCOUNTING_AP_MANAGE";
export const AR_MANAGE = "ACCOUNTING_AR_MANAGE";
export const SETTLEMENT_MATCH = "ACCOUNTING_SETTLEMENT_MATCH";
export const managementCode = (kind: string) => kind === "PAYABLE" ? AP_MANAGE : AR_MANAGE;
export function positiveCents(value: string | { toString(): string }): bigint {
  const amount = accountingCents(value);
  if (amount <= 0n) throw new HttpError(400, "AP/AR amounts must be positive exact decimals.");
  return amount;
}
export function exactDocumentTotal(lines: readonly { amount: string | { toString(): string } }[]): string {
  if (!lines.length) throw new HttpError(400, "Document requires a line.");
  const total = lines.reduce((sum, line) => sum + positiveCents(line.amount), 0n);
  const decimal = centsToDecimal(total);
  accountingCents(decimal); // A control line must also fit DECIMAL(20,2).
  return decimal;
}
export function validateAllocations(amount: string, allocations: readonly { accountingDocumentId: string; allocatedAmount: string }[]) {
  if (!allocations.length || new Set(allocations.map(a => a.accountingDocumentId)).size !== allocations.length) {
    throw new HttpError(400, "Settlement requires unique document allocations.");
  }
  const sum = allocations.reduce((total, allocation) => total + positiveCents(allocation.allocatedAmount), 0n);
  if (sum !== positiveCents(amount)) throw new HttpError(400, "Settlement amount must equal its allocations exactly; unapplied overpayments are not posted.");
}
export function outstandingCents(original: string, adjustments: string, settlements: string): bigint {
  return accountingTotalCents(original) + accountingTotalCents(adjustments) - accountingTotalCents(settlements);
}
export function assertNoOverpayment(allocation: string, outstanding: string) {
  if (positiveCents(allocation) > accountingTotalCents(outstanding)) {
    throw new HttpError(409, "Settlement allocation exceeds the document's posted outstanding balance.");
  }
}
export function agingBucket(asOf: string, dueDate: string) {
  const days = Math.floor((new Date(`${asOf}T00:00:00.000Z`).getTime() - new Date(`${dueDate}T00:00:00.000Z`).getTime()) / 86400000);
  return days <= 0 ? "CURRENT" : days <= 30 ? "DAYS_1_30" : days <= 60 ? "DAYS_31_60"
    : days <= 90 ? "DAYS_61_90" : "DAYS_OVER_90";
}
