import { centsToDecimal, decimalStringToCents } from "../../lib/money.js";
import { isOfficialDonationCandidate } from "../member/member-donation.rules.js";

export const ACCOUNTING_MENU_CODE = "ACCOUNTING_REPORT";
export const ACCOUNTING_ACCOUNTS = [
  { code: "1110", name: "Bank", accountType: "ASSET", normalBalance: "DEBIT" },
  { code: "4110", name: "Contribution Revenue", accountType: "REVENUE", normalBalance: "CREDIT" }
] as const;

export type AccountingState = "POSTED" | "NOT_APPLICABLE" | "PRE_CUTOVER_NON_ACCOUNTED"
  | "ACCOUNTING_REVIEW_REQUIRED" | "PREVIEW_NOT_POSTED";

export type AccountingSource = {
  id: string;
  status: string;
  sourceType: string;
  transactionDate: Date | null;
  originalAmount: string | { toString(): string };
  eventCodeId: string | null;
  eventCampaignId: string | null;
  eventType: string | null;
  reconciliationExcludedAt: Date | null;
};

export type AccountingDimension = {
  bankAccountId: string;
  bankNameSnapshot: string;
  bankAccountNoSnapshot: string;
  bankAccountNameSnapshot: string;
  eventCodeId: string | null;
  eventCodeSnapshot: string | null;
  eventNameSnapshot: string | null;
  eventTypeSnapshot: string | null;
  eventCampaignId: string | null;
  campaignNameSnapshot: string | null;
  memberIdentityId: string | null;
  donorNameSnapshot: string | null;
  memberId: string | null;
  memberCodeSnapshot: string | null;
  memberNameSnapshot: string | null;
};

export type AccountingLineDraft = AccountingDimension & {
  accountCode: "1110" | "4110";
  debit: string;
  credit: string;
};

/** Required deployment configuration; missing/invalid values never imply a historical cutover. */
export function parseAccountingCutover(value: string | undefined): Date {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(value)) {
    throw new Error("ACCOUNTING_CUTOVER_DATE must be the approved first day of a month (YYYY-MM-01).");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid ACCOUNTING_CUTOVER_DATE.");
  }
  return date;
}

export function accountingCutoverDate(): Date {
  return parseAccountingCutover(process.env.ACCOUNTING_CUTOVER_DATE);
}

/** Prisma @db.Date values are date-only evidence represented at UTC midnight. */
export function accountingDateValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Reject excess precision instead of inheriting the legacy helper's truncation. */
export function accountingCents(value: string | { toString(): string }): bigint {
  const text = value.toString();
  if (!/^-?\d{1,18}(\.\d{1,2})?$/.test(text)) throw new Error("Accounting amount must be an exact DECIMAL(20,2) value.");
  return decimalStringToCents(text);
}

/** Database SUM may exceed an individual DECIMAL(20,2) posting line. */
export function accountingTotalCents(value: string): bigint {
  if (!/^-?\d{1,65}(\.\d{1,2})?$/.test(value)) throw new Error("Invalid exact Accounting aggregate.");
  return decimalStringToCents(value);
}

export function recognitionEligible(source: AccountingSource, cutover: Date): boolean {
  return source.sourceType === "BANK"
    && source.transactionDate != null && source.transactionDate >= cutover
    && ["STANDARD", "CAMPAIGN", "TIME_BASED"].includes(source.eventType ?? "")
    && accountingCents(source.originalAmount) > 0n
    && isOfficialDonationCandidate(source);
}

/** Read-model state only: this never mutates operational evidence or a journal. */
export function accountingState(source: AccountingSource, hasRecognition: boolean, cutover: Date): AccountingState {
  if (source.status === "FINALIZED" && source.sourceType === "MANUAL") return "ACCOUNTING_REVIEW_REQUIRED";
  if (hasRecognition) return source.reconciliationExcludedAt ? "ACCOUNTING_REVIEW_REQUIRED" : "POSTED";
  if (source.transactionDate && source.transactionDate < cutover) return "PRE_CUTOVER_NON_ACCOUNTED";
  if (source.status === "CHECK") return "PREVIEW_NOT_POSTED";
  if (source.status === "FINALIZED" && source.reconciliationExcludedAt) return "NOT_APPLICABLE";
  if (source.status === "FINALIZED" && accountingCents(source.originalAmount) > 0n) return "ACCOUNTING_REVIEW_REQUIRED";
  return "NOT_APPLICABLE";
}

export function assertBalanced(lines: readonly Pick<AccountingLineDraft, "debit" | "credit">[]): void {
  if (lines.length < 2) throw new Error("A journal requires at least two posting lines.");
  let debit = 0n;
  let credit = 0n;
  for (const line of lines) {
    const dr = accountingCents(line.debit);
    const cr = accountingCents(line.credit);
    if (dr < 0n || cr < 0n || (dr > 0n) === (cr > 0n)) {
      throw new Error("Every posting line requires exactly one positive debit or credit.");
    }
    debit += dr;
    credit += cr;
  }
  if (debit !== credit) throw new Error("Accounting journal is unbalanced.");
}

/** Shared pure construction for preview and posting; allocates no journal identity. */
export function recognitionLines(source: AccountingSource, dimension: AccountingDimension, cutover: Date): AccountingLineDraft[] {
  if (!recognitionEligible(source, cutover)) return [];
  const amount = centsToDecimal(accountingCents(source.originalAmount));
  const lines: AccountingLineDraft[] = [
    { ...dimension, accountCode: "1110", debit: amount, credit: "0.00" },
    { ...dimension, accountCode: "4110", debit: "0.00", credit: amount }
  ];
  assertBalanced(lines);
  return lines;
}

export function reclassificationLines(amount: string, previous: AccountingDimension, next: AccountingDimension): AccountingLineDraft[] {
  if (previous.eventCodeId === next.eventCodeId && previous.eventCampaignId === next.eventCampaignId) return [];
  // Member/bank/donor snapshots remain the original posting evidence.
  const keys: Array<keyof AccountingDimension> = ["bankAccountId", "bankNameSnapshot", "bankAccountNoSnapshot", "bankAccountNameSnapshot",
    "eventCodeId", "eventCodeSnapshot", "eventNameSnapshot", "eventTypeSnapshot", "eventCampaignId", "campaignNameSnapshot",
    "memberIdentityId", "donorNameSnapshot", "memberId", "memberCodeSnapshot", "memberNameSnapshot"];
  // Persisted lines can structurally satisfy the dimension type; never copy their PK/journal FK.
  const snapshot = Object.fromEntries(keys.map(key => [key, previous[key]])) as AccountingDimension;
  const approvedDimensions = { ...snapshot, eventCodeId: next.eventCodeId, eventCodeSnapshot: next.eventCodeSnapshot,
    eventNameSnapshot: next.eventNameSnapshot, eventTypeSnapshot: next.eventTypeSnapshot,
    eventCampaignId: next.eventCampaignId, campaignNameSnapshot: next.campaignNameSnapshot };
  const value = centsToDecimal(accountingCents(amount));
  const lines: AccountingLineDraft[] = [
    { ...snapshot, accountCode: "4110", debit: value, credit: "0.00" },
    { ...approvedDimensions, accountCode: "4110", debit: "0.00", credit: value }
  ];
  assertBalanced(lines);
  return lines;
}
