import { centsToDecimal, decimalStringToCents } from "../../../lib/money.js";
import { categoryLabel } from "../../member/data/member-donation.domain.js";

type Amount = { toString(): string } | string | null;

export type DashboardDonationGroup = {
  memberIdentityId: string | null;
  eventCodeId: string | null;
  _count: { _all: number };
  _sum: { originalAmount: Amount };
};

export type DashboardIdentity = {
  id: string;
  verificationStatus: string;
  member: { id: string; memberCode: string; memberName: string; activeFlag: boolean } | null;
};

export type DashboardEventCode = {
  id: string;
  code: string;
  eventName: string;
  category: string | null;
};

function amountCents(value: Amount) {
  return decimalStringToCents(typeof value === "string" ? value : value?.toString() ?? "0");
}

export function isRegistrationFollowUpIdentity(identity: { verificationStatus: string; memberId: string | null }) {
  return identity.verificationStatus === "UNVERIFIED" && identity.memberId === null;
}

export function summarizeDashboardMemberDonations(
  groups: DashboardDonationGroup[],
  identities: DashboardIdentity[],
  eventCodes: DashboardEventCode[]
) {
  const identityById = new Map(identities.map(identity => [identity.id, identity]));
  const eventById = new Map(eventCodes.map(event => [event.id, event]));
  const linkedIdentityIds = new Set<string>();
  const unlinkedIdentityIds = new Set<string>();
  const contributingMemberIds = new Set<string>();
  const members = new Map<string, { memberId: string; memberCode: string; memberName: string; activeFlag: boolean; transactionCount: number; cents: bigint }>();
  const categories = new Map<string, { category: string; memberIds: Set<string>; transactionCount: number; cents: bigint; events: Map<string, { eventCodeId: string; eventCode: string; eventName: string; category: string; memberIds: Set<string>; transactionCount: number; cents: bigint }> }>();
  let linkedTransactionCount = 0;
  let linkedCents = 0n;
  let unlinkedTransactionCount = 0;
  let unlinkedCents = 0n;

  for (const group of groups) {
    if (!group.memberIdentityId) continue;
    const identity = identityById.get(group.memberIdentityId);
    if (!identity) continue;
    const cents = amountCents(group._sum.originalAmount);
    const member = identity.verificationStatus === "VERIFIED" ? identity.member : null;
    if (!member) {
      if (identity.verificationStatus === "UNVERIFIED" && identity.member === null) {
        unlinkedIdentityIds.add(identity.id);
        unlinkedTransactionCount += group._count._all;
        unlinkedCents += cents;
      }
      continue;
    }

    linkedIdentityIds.add(identity.id);
    contributingMemberIds.add(member.id);
    linkedTransactionCount += group._count._all;
    linkedCents += cents;
    const memberTotal = members.get(member.id) ?? {
      memberId: member.id, memberCode: member.memberCode, memberName: member.memberName,
      activeFlag: member.activeFlag, transactionCount: 0, cents: 0n
    };
    memberTotal.transactionCount += group._count._all;
    memberTotal.cents += cents;
    members.set(member.id, memberTotal);

    if (!group.eventCodeId) continue;
    const event = eventById.get(group.eventCodeId);
    if (!event) continue;
    const category = categoryLabel(event.category);
    const categoryTotal = categories.get(category) ?? {
      category, memberIds: new Set<string>(), transactionCount: 0, cents: 0n, events: new Map()
    };
    categoryTotal.memberIds.add(member.id);
    categoryTotal.transactionCount += group._count._all;
    categoryTotal.cents += cents;
    const eventTotal = categoryTotal.events.get(event.id) ?? {
      eventCodeId: event.id, eventCode: event.code, eventName: event.eventName, category,
      memberIds: new Set<string>(), transactionCount: 0, cents: 0n
    };
    eventTotal.memberIds.add(member.id);
    eventTotal.transactionCount += group._count._all;
    eventTotal.cents += cents;
    categoryTotal.events.set(event.id, eventTotal);
    categories.set(category, categoryTotal);
  }

  const compareAmountThenCode = <T extends { cents: bigint; memberCode?: string; eventCode?: string }>(left: T, right: T) =>
    left.cents === right.cents
      ? (left.memberCode ?? left.eventCode ?? "").localeCompare(right.memberCode ?? right.eventCode ?? "")
      : left.cents > right.cents ? -1 : 1;

  return {
    linkedTransactionCount,
    linkedIdentityCount: linkedIdentityIds.size,
    linkedAmount: centsToDecimal(linkedCents),
    contributingMemberCount: contributingMemberIds.size,
    unlinkedTransactionCount,
    unlinkedIdentityCount: unlinkedIdentityIds.size,
    unlinkedObservedAmount: centsToDecimal(unlinkedCents),
    topMembers: [...members.values()].sort(compareAmountThenCode).slice(0, 5)
      .map(({ cents, ...member }) => ({ ...member, amount: centsToDecimal(cents) })),
    eventGroups: [...categories.values()]
      .sort((left, right) => left.cents === right.cents ? left.category.localeCompare(right.category) : left.cents > right.cents ? -1 : 1)
      .map(category => ({
        category: category.category,
        memberCount: category.memberIds.size,
        transactionCount: category.transactionCount,
        amount: centsToDecimal(category.cents),
        events: [...category.events.values()].sort(compareAmountThenCode).map(({ cents, memberIds, ...event }) => ({
          ...event, memberCount: memberIds.size, amount: centsToDecimal(cents)
        }))
      }))
  };
}
