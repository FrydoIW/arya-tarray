import { centsToDecimal, decimalStringToCents } from "../../../lib/money.js";
import { isCanonicalMemberDonationCandidate } from "../member-donation.rules.js";

export { centsToDecimal };

export type DonationCandidate = {
  status: string;
  originalAmount: { toString(): string } | string;
  eventCodeId: string | null;
  memberId: string | null;
  identityStatus: string;
  transactionId: string;
  transactionDate: Date;
};

export function isOfficialMemberDonation(row: DonationCandidate, memberId: string) {
  return isCanonicalMemberDonationCandidate(row, memberId);
}

export function summarizeDonationCandidates(rows: DonationCandidate[], memberId: string, context?: { start: Date; end: Date; eventCodeId?: string }) {
  const seen = new Set<string>();
  let cents = 0n;
  for (const row of rows) {
    if (seen.has(row.transactionId) || !isOfficialMemberDonation(row, memberId)) continue;
    if (context && (row.transactionDate < context.start || row.transactionDate >= context.end || (context.eventCodeId && row.eventCodeId !== context.eventCodeId))) continue;
    seen.add(row.transactionId);
    cents += decimalStringToCents(typeof row.originalAmount === "string" ? row.originalAmount : row.originalAmount.toString());
  }
  return { amount: centsToDecimal(cents), transactionCount: seen.size };
}

export function categoryLabel(value: string | null) {
  return value?.trim() || "Uncategorized";
}

export function aggregateCategories(rows: Array<{ category: string | null; transactionCount: number; amount: { toString(): string } | string }>) {
  const groups = new Map<string, { category: string; transactionCount: number; eventCount: number; cents: bigint }>();
  for (const row of rows) {
    const category = categoryLabel(row.category);
    const current = groups.get(category) ?? { category, transactionCount: 0, eventCount: 0, cents: 0n };
    current.transactionCount += row.transactionCount;
    current.eventCount += 1;
    current.cents += decimalStringToCents(typeof row.amount === "string" ? row.amount : row.amount.toString());
    groups.set(category, current);
  }
  return [...groups.values()].sort((a, b) => a.cents === b.cents ? a.category.localeCompare(b.category) : a.cents > b.cents ? -1 : 1)
    .map(({ cents, ...row }) => ({ ...row, amount: centsToDecimal(cents) }));
}
