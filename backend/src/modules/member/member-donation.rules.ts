import type { Prisma } from "@prisma/client";
import { decimalStringToCents } from "../reconciliation/reconciliation-classification.js";

export type OfficialDonationCandidate = {
  status: string;
  originalAmount: { toString(): string } | string;
  eventCodeId: string | null;
};

export type CanonicalMemberDonationCandidate = OfficialDonationCandidate & {
  memberId: string | null;
  identityStatus: string;
};

/** Financial truth shared by Member Data and Monitoring Dashboard. */
export function officialDonationTransactionWhere(): Prisma.BankTransactionWhereInput {
  return {
    status: "FINALIZED",
    originalAmount: { gt: 0 },
    eventCodeId: { not: null }
  };
}

/** Official donation scope plus the current canonical identity ownership. */
export function canonicalMemberDonationWhere(memberId: string): Prisma.BankTransactionWhereInput {
  return {
    AND: [
      officialDonationTransactionWhere(),
      { memberIdentity: { is: { memberId, verificationStatus: "VERIFIED" } } }
    ]
  };
}

export function isOfficialDonationCandidate(row: OfficialDonationCandidate) {
  const amount = typeof row.originalAmount === "string" ? row.originalAmount : row.originalAmount.toString();
  return row.status === "FINALIZED"
    && decimalStringToCents(amount) > 0n
    && Boolean(row.eventCodeId);
}

export function isCanonicalMemberDonationCandidate(row: CanonicalMemberDonationCandidate, memberId: string) {
  return isOfficialDonationCandidate(row)
    && row.memberId === memberId
    && row.identityStatus === "VERIFIED";
}
