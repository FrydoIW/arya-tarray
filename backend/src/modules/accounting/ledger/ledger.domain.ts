import { accountingCents } from "../accounting.domain.js";

export type LedgerLineInput = {
  accountId: string;
  debit: string;
  credit: string;
  bankAccountId?: string | null;
  accountingFundId?: string | null;
  fundRestrictionId?: string | null;
  counterpartyId?: string | null;
  eventCodeId?: string | null;
  eventCampaignId?: string | null;
  memberIdentityId?: string | null;
  memberId?: string | null;
};

export function validateLedgerLines(lines: readonly LedgerLineInput[]): void {
  if (lines.length < 2 || lines.length > 500) throw new Error("A journal requires 2–500 posting lines.");
  let debit = 0n;
  let credit = 0n;
  for (const line of lines) {
    const dr = accountingCents(line.debit);
    const cr = accountingCents(line.credit);
    if (dr < 0n || cr < 0n || (dr > 0n) === (cr > 0n)) {
      throw new Error("Each journal line requires exactly one positive debit or credit.");
    }
    debit += dr;
    credit += cr;
  }
  if (debit !== credit) throw new Error("Journal debits and credits must balance exactly.");
}
