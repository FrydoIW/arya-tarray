import { Prisma } from "@prisma/client";
import type { AuditedJournal } from "../../src/modules/accounting/ledger/ledger-audit.js";
export function syntheticAuditJournal(index: number, input: { actor?: string; period?: string; debitAccount?: string; creditAccount?: string } = {}): AuditedJournal {
  const suffix = String(index).padStart(12, "0"), id = `00000000-0000-4000-8000-${suffix}`;
  const line = { bankAccountId: null, bankNameSnapshot: null, bankAccountNoSnapshot: null, bankAccountNameSnapshot: null,
    accountingFundId: null, fundRestrictionId: null, counterpartyId: null, eventCodeId: null, eventCodeSnapshot: null, eventNameSnapshot: null, eventTypeSnapshot: null,
    eventCampaignId: null, campaignNameSnapshot: null, memberIdentityId: null, donorNameSnapshot: null, memberId: null, memberCodeSnapshot: null, memberNameSnapshot: null };
  return { id, journalNumber: `AUD-${id}`, journalType: "MANUAL", sourceEventKey: `AUDIT-TEST:${id}`, accountingDate: new Date("2026-11-03"),
    accountingPeriodId: input.period ?? "period", postedAt: new Date("2026-11-03T12:00:00.000Z"), postedById: input.actor ?? "actor", descriptionSnapshot: "Synthetic TEST ledger capacity evidence",
    bankTransactionId: null, sourceKind: "MANUAL_JOURNAL", sourceReference: id, correctionItemId: null, relatedJournalId: null, reversalOfJournalId: null,
    lines: [{ ...line, id: `10000000-0000-4000-8000-${suffix}`, lineNo: 1, accountId: input.debitAccount ?? "debit", accountCodeSnapshot: "TEST-DR", accountNameSnapshot: "Synthetic debit", debit: new Prisma.Decimal("1.00"), credit: new Prisma.Decimal("0.00") },
      { ...line, id: `20000000-0000-4000-8000-${suffix}`, lineNo: 2, accountId: input.creditAccount ?? "credit", accountCodeSnapshot: "TEST-CR", accountNameSnapshot: "Synthetic credit", debit: new Prisma.Decimal("0.00"), credit: new Prisma.Decimal("1.00") }] };
}
