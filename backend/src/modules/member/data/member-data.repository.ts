import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { HttpError } from "../../../lib/http.js";
import { memberTransaction } from "../member-identity/member-transaction.js";
import { recordMemberIdentityHistory } from "../member-identity/member-identity-history.js";
import type { IdentityMetadataInput, MemberDataWorkspaceQuery, MemberProfileInput } from "./member-data.schema.js";
import { detachedIdentityData, verifiedIdentityData } from "./member-data.domain.js";
import { canonicalMemberDonationWhere, officialDonationTransactionWhere } from "../member-donation.rules.js";
import { reconcileTimeBasedCoverageForIdentity, synchronizePendingTimeBasedForMember } from "../time-based/member-time-based.service.js";
import { synchronizePendingCampaignContributionsForMember } from "../campaign/member-campaign-wallet.service.js";
import { currentBusinessDayValue } from "../../../lib/business-time.js";

export type MemberDonationFilter = { periodStart: Date; periodEnd: Date; eventCodeId?: string; search?: string };

const actorSelect = { id: true, fullName: true } as const;
const eventSelect = { id: true, code: true, eventName: true, category: true, activeFlag: true } as const;
const memberOptionSelect = { id: true, memberCode: true, memberName: true } as const;
const memberListSelect = {
  id: true, memberCode: true, memberName: true, initialName: true, birthDate: true,
  phone: true, email: true, city: true, registrationSource: true, activeFlag: true,
  registeredAt: true, _count: { select: { identities: true } }
} as const;

export function memberCarryFilter(programBalance: string, positiveSubscriptionIds: string[]): Prisma.MemberWhereInput {
  if (programBalance === "ALL") return {};
  const condition = { id: { in: positiveSubscriptionIds } };
  return { eventSubscriptions: programBalance === "HAS_CARRY" ? { some: condition } : { none: condition } };
}

export async function loadMemberCarryFilter(tx: Pick<Prisma.TransactionClient, "memberEventBalanceLedger">, programBalance: string) {
  if (programBalance === "ALL") return {};
  const groups = await tx.memberEventBalanceLedger.groupBy({
    by: ["subscriptionId"], where: { entryStatus: "ACTIVE", subscription: { eventCode: { eventType: "TIME_BASED" } } },
    _sum: { amountDelta: true }, having: { amountDelta: { _sum: { gt: 0 } } }
  });
  return memberCarryFilter(programBalance, groups.map(row => row.subscriptionId));
}

export async function workspaceRecords(query: MemberDataWorkspaceQuery) {
  const where: Prisma.MemberWhereInput = {
    ...(query.status === "ACTIVE" ? { activeFlag: true } : query.status === "INACTIVE" ? { activeFlag: false } : {}),
    ...(query.city ? { city: query.city } : {}),
    ...(query.registrationSource !== "ALL" ? { registrationSource: query.registrationSource } : {}),
    ...(query.search ? { OR: [
      { memberCode: { contains: query.search } }, { memberName: { contains: query.search } },
      { initialName: { contains: query.search } }, { phone: { contains: query.search } },
      { email: { contains: query.search } },
      { identities: { some: { accountName: { contains: query.search } } } }
    ] } : {})
  };
  return prisma.$transaction(async tx => {
    where.AND = [await loadMemberCarryFilter(tx, query.programBalance)];
    const [total, active, inactive, manual, statement, cities] = await Promise.all([
      tx.member.count({ where }), tx.member.count({ where: { activeFlag: true } }),
      tx.member.count({ where: { activeFlag: false } }), tx.member.count({ where: { registrationSource: "MANUAL" } }),
      tx.member.count({ where: { registrationSource: "STATEMENT" } }),
      tx.member.findMany({ where: { city: { not: null } }, distinct: ["city"], select: { city: true }, orderBy: { city: "asc" } })
    ]);
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const rows = await tx.member.findMany({
      where, skip: (page - 1) * query.pageSize, take: query.pageSize,
      orderBy: [{ registeredAt: "desc" }, { id: "asc" }], select: memberListSelect
    });
    return { rows, total, page, summary: { total: active + inactive, active, inactive, manual, statement }, cities: cities.flatMap(row => row.city ? [row.city] : []) };
  });
}

const officialDonationWhere = (identityIds: string[]): Prisma.BankTransactionWhereInput => ({
  AND: [officialDonationTransactionWhere(), { memberIdentityId: { in: identityIds } }]
});

export async function loadWorkspaceDonationAnalytics(memberIds: string[]) {
  if (!memberIds.length) return { identities: [], lifetime: [] };
  const identities = await prisma.memberIdentity.findMany({
    where: { memberId: { in: memberIds }, verificationStatus: "VERIFIED" }, select: { id: true, memberId: true }
  });
  const identityIds = identities.map(identity => identity.id);
  if (!identityIds.length) return { identities, lifetime: [] };
  const base = officialDonationWhere(identityIds);
  const lifetime = await prisma.bankTransaction.groupBy({ by: ["memberIdentityId"], where: base, _sum: { originalAmount: true }, _count: { _all: true } });
  return { identities, lifetime };
}

export async function loadMemberDonationRecords(memberId: string, filter: MemberDonationFilter, requestedPage: number, pageSize: number) {
  const relation = canonicalMemberDonationWhere(memberId);
  const periodWhere: Prisma.BankTransactionWhereInput = { AND: [relation, {
    transactionDate: { gte: filter.periodStart, lt: filter.periodEnd }, ...(filter.eventCodeId ? { eventCodeId: filter.eventCodeId } : {})
  }] };
  const rowWhere: Prisma.BankTransactionWhereInput = filter.search ? {
    AND: [periodWhere, { OR: [
      { description: { contains: filter.search } },
      { referenceNo: { contains: filter.search } }
    ] }]
  } : periodWhere;

  return prisma.$transaction(async tx => {
    const [member, lifetime, period, total, eventGroups, eventOptions] = await Promise.all([
      tx.member.findUnique({ where: { id: memberId }, select: { id: true, memberCode: true, memberName: true } }),
      tx.bankTransaction.aggregate({ where: relation, _sum: { originalAmount: true }, _count: { _all: true } }),
      tx.bankTransaction.aggregate({ where: periodWhere, _sum: { originalAmount: true }, _count: { _all: true } }),
      tx.bankTransaction.count({ where: rowWhere }),
      tx.bankTransaction.groupBy({ by: ["eventCodeId"], where: periodWhere,
        _sum: { originalAmount: true }, _count: { _all: true }, orderBy: { _sum: { originalAmount: "desc" } } }),
      tx.eventCode.findMany({
        where: { OR: [{ activeFlag: true }, { transactions: { some: relation } }] },
        select: eventSelect, orderBy: [{ code: "asc" }, { eventName: "asc" }]
      })
    ]);
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const rows = await tx.bankTransaction.findMany({
      where: rowWhere, skip: (page - 1) * pageSize, take: pageSize,
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true, transactionDate: true, referenceNo: true, description: true, originalAmount: true,
        sourceType: true, correctionReason: true, manualAddedAt: true,
        manualAddedBy: { select: actorSelect },
        memberIdentity: { select: { id: true, accountName: true, initialName: true, sourceType: true } },
        eventCode: { select: eventSelect },
        statementUpload: { select: { id: true, fileName: true } }
      }
    });
    const eventIds = eventGroups.flatMap(group => group.eventCodeId ? [group.eventCodeId] : []);
    const events = eventIds.length ? await tx.eventCode.findMany({ where: { id: { in: eventIds } }, select: eventSelect }) : [];
    return { member, lifetime, period, total, page, rows, eventGroups, events, eventOptions };
  });
}

export function findMemberDetail(memberId: string) {
  return prisma.member.findUnique({ where: { id: memberId }, select: {
    id: true, memberCode: true, memberName: true, initialName: true, birthDate: true,
    phone: true, email: true, address: true, city: true, registrationSource: true,
    activeFlag: true, remark: true, registeredAt: true, createdAt: true, updatedAt: true,
    registeredBy: { select: actorSelect }, createdBy: { select: actorSelect }, updatedBy: { select: actorSelect },
    identities: { orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }], select: {
      id: true, sourceType: true, accountName: true, initialName: true, normalizedName: true,
      bankName: true, accountNumber: true, accountType: true, verificationStatus: true,
      firstSeenAt: true, lastSeenAt: true, verifiedAt: true, remark: true,
      _count: { select: { transactions: true } }
    } }
  } });
}

export function pendingTimeBasedPaymentsWhere(memberId: string): Prisma.BankTransactionWhereInput {
  return { status: "FINALIZED", reconciliationExcludedAt: null, originalAmount: { gt: 0 },
    eventCode: { is: { eventType: "TIME_BASED" } },
    memberIdentity: { is: { memberId, verificationStatus: "VERIFIED" } },
    memberEventBalanceLedger: { none: { entryType: "PAYMENT", entryStatus: "ACTIVE" } } };
}

export function loadMemberSponsorship(memberId: string) {
  return prisma.$transaction(async tx => {
    const [member, subscriptions, pending, eventOptions, contributionGroups, legacyCampaignContributionGroups, campaignAllocations, campaignWalletEntries, campaignParticipations, campaignOptions] = await Promise.all([
      tx.member.findUnique({ where: { id: memberId }, select: { id: true } }),
      tx.memberEventSubscription.findMany({ where: { memberId }, include: {
        eventCode: { select: { id: true, code: true, eventName: true, eventType: true, activeFlag: true, timeRule: { select: { unitAmount: true, durationMonths: true, activeFlag: true } } } },
        coverages: { include: { bankTransaction: { select: { id: true, transactionDate: true, referenceNo: true, originalAmount: true, baseAmount: true } } }, orderBy: [{ coverageFrom: "desc" }, { id: "desc" }] },
        balanceLedger: { select: { id: true, bankTransactionId: true, entryType: true, entryStatus: true, amountDelta: true, effectiveDate: true, unitAmountSnapshot: true, durationMonthsSnapshot: true, voidReason: true, createdAt: true, bankTransaction: { select: { referenceNo: true } } }, orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 24 }
      }, orderBy: [{ activeFlag: "desc" }, { validUntil: "asc" }, { id: "asc" }] }),
      tx.bankTransaction.findMany({ where: pendingTimeBasedPaymentsWhere(memberId), select: {
        id: true, transactionDate: true, referenceNo: true, originalAmount: true, baseAmount: true,
        memberEventCoverages: { where: { coverageSource: "TRANSACTION" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { coverageStatus: true, unitAmountSnapshot: true, durationMonthsSnapshot: true, grantedUnits: true, amountApplied: true, subscription: { select: { eventCodeId: true } } } },
        memberEventBalanceLedger: { where: { entryType: "PAYMENT" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { entryType: true, amountDelta: true, unitAmountSnapshot: true, durationMonthsSnapshot: true, subscription: { select: { eventCodeId: true } } } },
        eventCode: { select: { id: true, code: true, eventName: true, timeRule: { select: { unitAmount: true, durationMonths: true, activeFlag: true } } } }
      }, orderBy: [{ transactionDate: "desc" }, { id: "desc" }] }),
      tx.eventCode.findMany({ where: { eventType: "TIME_BASED", activeFlag: true, timeRule: { is: { activeFlag: true } } }, select: { id: true, code: true, eventName: true }, orderBy: [{ code: "asc" }, { eventName: "asc" }] }),
      tx.bankTransaction.groupBy({
        by: ["eventCodeId", "eventCampaignId"], where: canonicalMemberDonationWhere(memberId),
        _sum: { originalAmount: true }, _count: { _all: true }
      }),
      tx.bankTransaction.groupBy({
        by: ["eventCampaignId"], where: { ...canonicalMemberDonationWhere(memberId), eventCampaignId: { not: null },
          memberEventCampaignAllocations: { none: {} } }, _sum: { originalAmount: true }
      }),
      tx.memberEventCampaignAllocation.findMany({
        where: { memberId }, orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        select: { id: true, eventCampaignId: true, amountDelta: true, allocationType: true, allocationStatus: true, effectiveDate: true, reason: true,
          eventCampaign: { select: { id: true, campaignName: true, eventCodeId: true, targetAmount: true, activeFlag: true, startDate: true, endDate: true,
            eventCode: { select: { code: true, eventName: true, eventType: true, activeFlag: true } } } } }
      }),
      tx.memberEventCampaignWalletLedger.findMany({
        where: { memberId }, orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        select: { id: true, eventCampaignId: true, amountDelta: true, entryType: true, entryStatus: true, effectiveDate: true, remark: true }
      }),
      tx.memberEventCampaignParticipation.findMany({
        where: { memberId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: { id: true, eventCampaignId: true, activeFlag: true, remark: true, createdAt: true }
      }),
      tx.eventCampaign.findMany({
        where: { activeFlag: true, eventCode: { eventType: "CAMPAIGN", activeFlag: true }, OR: [
          { startDate: null }, { startDate: { lte: new Date(`${currentBusinessDayValue()}T00:00:00.000Z`) } }
        ], AND: [{ OR: [{ endDate: null }, { endDate: { gte: new Date(`${currentBusinessDayValue()}T00:00:00.000Z`) } }] }] },
        select: { id: true, campaignName: true, eventCodeId: true, targetAmount: true, activeFlag: true, startDate: true, endDate: true, eventCode: { select: { code: true, eventName: true, activeFlag: true } } },
        orderBy: [{ campaignName: "asc" }, { id: "asc" }]
      })
    ]);
    const balances = subscriptions.length ? await tx.memberEventBalanceLedger.groupBy({
      by: ["subscriptionId", "entryType"], where: { subscriptionId: { in: subscriptions.map(row => row.id) }, entryStatus: "ACTIVE" },
      _sum: { amountDelta: true }
    }) : [];
    const paymentDates = subscriptions.length ? await tx.memberEventBalanceLedger.findMany({
      where: { subscriptionId: { in: subscriptions.map(row => row.id) }, entryStatus: "ACTIVE", OR: [
        { entryType: "PAYMENT" }, { entryType: "TRANSFER_IN", carryTransfer: { is: { status: "ACTIVE" } } }
      ] },
      select: { subscriptionId: true, effectiveDate: true }
    }) : [];
    const contributionEventIds = [...new Set(contributionGroups.flatMap(row => row.eventCodeId ? [row.eventCodeId] : []))];
    const contributionCampaignIds = [...new Set(contributionGroups.flatMap(row => row.eventCampaignId ? [row.eventCampaignId] : []))];
    const participatingCampaignIds = [...new Set([
      ...contributionCampaignIds,
      ...campaignAllocations.map(row => row.eventCampaignId),
      ...campaignWalletEntries.map(row => row.eventCampaignId),
      ...campaignParticipations.map(row => row.eventCampaignId)
    ])];
    const [contributionEvents, contributionCampaigns] = await Promise.all([
      contributionEventIds.length ? tx.eventCode.findMany({ where: { id: { in: contributionEventIds } },
        select: { id: true, code: true, eventName: true, eventType: true, category: true } }) : [],
      participatingCampaignIds.length ? tx.eventCampaign.findMany({ where: { id: { in: participatingCampaignIds } },
        select: { id: true, eventCodeId: true, campaignName: true, targetAmount: true, activeFlag: true, startDate: true, endDate: true,
          eventCode: { select: { code: true, eventName: true, eventType: true, activeFlag: true } } } }) : []
    ]);
    const capacityCampaignIds = [...new Set([...contributionCampaigns.map(row => row.id), ...campaignOptions.map(row => row.id)])];
    const [campaignAppliedGroups, campaignLegacyAppliedGroups] = capacityCampaignIds.length ? await Promise.all([
      tx.memberEventCampaignAllocation.groupBy({ by: ["eventCampaignId"], where: { eventCampaignId: { in: capacityCampaignIds }, allocationStatus: "ACTIVE" }, _sum: { amountDelta: true } }),
      tx.bankTransaction.groupBy({ by: ["eventCampaignId"], where: { eventCampaignId: { in: capacityCampaignIds }, status: "FINALIZED", reconciliationExcludedAt: null, originalAmount: { gt: 0 }, memberEventCampaignAllocations: { none: {} } }, _sum: { originalAmount: true } })
    ]) : [[], []];
    return { member, subscriptions, paymentDates, pending, eventOptions, balances, contributionGroups, legacyCampaignContributionGroups, contributionEvents,
      contributionCampaigns, campaignMasters: contributionCampaigns, campaignAllocations, campaignWalletEntries, campaignParticipations, campaignOptions,
      campaignAppliedGroups, campaignLegacyAppliedGroups };
  });
}

export async function loadIdentityHistory(memberId: string, requestedPage: number, pageSize: number) {
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true } });
  if (!member) return { member: null, rows: [], total: 0, page: 1 };
  const where: Prisma.MemberIdentityHistoryWhereInput = { OR: [{ fromMemberId: memberId }, { toMemberId: memberId }] };
  return prisma.$transaction(async tx => {
    const total = await tx.memberIdentityHistory.count({ where });
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const rows = await tx.memberIdentityHistory.findMany({
      where, skip: (page - 1) * pageSize, take: pageSize,
      orderBy: [{ actionAt: "desc" }, { id: "desc" }],
      select: {
        id: true, action: true, statusBefore: true, statusAfter: true, reason: true, actionAt: true,
        memberIdentity: { select: { id: true, accountName: true, sourceType: true, bankName: true, accountNumber: true } },
        fromMember: { select: memberOptionSelect }, toMember: { select: memberOptionSelect }, actionBy: { select: actorSelect }
      }
    });
    return { member, rows, total, page };
  });
}

export function findIdentityOptions(search: string) {
  return prisma.memberIdentity.findMany({
    where: { memberId: null, verificationStatus: "UNVERIFIED", ...(search ? { OR: [
      { accountName: { contains: search } }, { initialName: { contains: search } },
      { normalizedName: { contains: search } }, { accountNumber: { contains: search } }
    ] } : {}) },
    take: 25, orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
    select: { id: true, sourceType: true, accountName: true, initialName: true, bankName: true,
      accountNumber: true, accountType: true, firstSeenAt: true, lastSeenAt: true,
      _count: { select: { transactions: true } } }
  });
}

export function findActiveMemberOptions(search: string, excludeMemberId?: string) {
  return prisma.member.findMany({
    where: { activeFlag: true, ...(excludeMemberId ? { id: { not: excludeMemberId } } : {}), ...(search ? { OR: [
      { memberName: { contains: search } }, { memberCode: { contains: search } },
      { initialName: { contains: search } }, { city: { contains: search } }
    ] } : {}) },
    select: { id: true, memberCode: true, memberName: true, initialName: true, city: true, activeFlag: true },
    take: 25, orderBy: [{ memberName: "asc" }, { id: "asc" }]
  });
}

export async function updateMember(memberId: string, input: MemberProfileInput, userId: string) {
  const exists = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true } });
  if (!exists) throw new HttpError(404, "Donatur tidak ditemukan.");
  return prisma.member.update({ where: { id: memberId }, data: {
    ...input, birthDate: input.birthDate === undefined ? undefined : input.birthDate ? new Date(input.birthDate + "T00:00:00.000Z") : null,
    updatedById: userId
  }, select: memberListSelect });
}

export function updateMemberLifecycle(memberId: string, activeFlag: boolean, userId: string) {
  return memberTransaction(async tx => {
    const member = await tx.member.findUnique({ where: { id: memberId }, select: { id: true, activeFlag: true } });
    if (!member) throw new HttpError(404, "Donatur tidak ditemukan.");
    if (member.activeFlag === activeFlag) throw new HttpError(409, activeFlag ? "Donatur sudah aktif." : "Donatur sudah nonaktif.");
    return tx.member.update({ where: { id: memberId }, data: { activeFlag, updatedById: userId }, select: memberListSelect });
  });
}

async function requireActiveMember(tx: Prisma.TransactionClient, memberId: string) {
  const member = await tx.member.findUnique({ where: { id: memberId }, select: { id: true, activeFlag: true } });
  if (!member) throw new HttpError(404, "Donatur tidak ditemukan.");
  if (!member.activeFlag) throw new HttpError(400, "Donatur nonaktif tidak dapat menerima identitas.");
}

async function identityState(tx: Prisma.TransactionClient, identityId: string) {
  const identity = await tx.memberIdentity.findUnique({ where: { id: identityId }, select: { id: true, memberId: true, verificationStatus: true } });
  if (!identity) throw new HttpError(404, "Identitas tidak ditemukan.");
  return identity;
}

export function attachIdentity(memberId: string, identityId: string, userId: string) {
  return memberTransaction(async tx => {
    await requireActiveMember(tx, memberId);
    const identity = await identityState(tx, identityId);
    if (identity.memberId || identity.verificationStatus !== "UNVERIFIED") throw new HttpError(409, "Identitas sudah diproses. Muat ulang data donatur.");
    const now = new Date();
    const result = await tx.memberIdentity.updateMany({
      where: { id: identityId, memberId: null, verificationStatus: "UNVERIFIED" },
      data: verifiedIdentityData(memberId, userId, now)
    });
    if (result.count !== 1) throw new HttpError(409, "Identitas berubah saat diproses. Muat ulang data donatur.");
    await recordMemberIdentityHistory(tx, {
      memberIdentityId: identityId, action: "ATTACH", before: identity,
      after: { memberId, verificationStatus: "VERIFIED" }, actionById: userId, actionAt: now
    });
    await synchronizePendingTimeBasedForMember(tx, memberId, userId);
    await synchronizePendingCampaignContributionsForMember(tx, memberId, userId);
  });
}

export function moveIdentity(sourceMemberId: string, identityId: string, destinationMemberId: string, reason: string, userId: string) {
  if (sourceMemberId === destinationMemberId) throw new HttpError(400, "Donatur tujuan harus berbeda.");
  return memberTransaction(async tx => {
    await requireActiveMember(tx, destinationMemberId);
    const identity = await identityState(tx, identityId);
    if (identity.memberId !== sourceMemberId || identity.verificationStatus !== "VERIFIED") throw new HttpError(409, "Identitas bukan lagi milik donatur ini. Muat ulang data.");
    const now = new Date();
    const result = await tx.memberIdentity.updateMany({
      where: { id: identityId, memberId: sourceMemberId, verificationStatus: "VERIFIED" },
      data: verifiedIdentityData(destinationMemberId, userId, now)
    });
    if (result.count !== 1) throw new HttpError(409, "Identitas berubah saat dipindahkan. Muat ulang data.");
    await recordMemberIdentityHistory(tx, {
      memberIdentityId: identityId, action: "MOVE", before: identity,
      after: { memberId: destinationMemberId, verificationStatus: "VERIFIED" }, reason, actionById: userId, actionAt: now
    });
    await reconcileTimeBasedCoverageForIdentity(tx, identityId, userId);
    await synchronizePendingTimeBasedForMember(tx, sourceMemberId, userId);
    await synchronizePendingTimeBasedForMember(tx, destinationMemberId, userId);
    await synchronizePendingCampaignContributionsForMember(tx, destinationMemberId, userId);
  });
}

export function detachIdentity(memberId: string, identityId: string, reason: string, userId: string) {
  return memberTransaction(async tx => {
    const identity = await identityState(tx, identityId);
    if (identity.memberId !== memberId || identity.verificationStatus !== "VERIFIED") throw new HttpError(409, "Identitas bukan lagi milik donatur ini. Muat ulang data.");
    const now = new Date();
    const result = await tx.memberIdentity.updateMany({
      where: { id: identityId, memberId, verificationStatus: "VERIFIED" },
      data: detachedIdentityData(userId)
    });
    if (result.count !== 1) throw new HttpError(409, "Identitas berubah saat dilepas. Muat ulang data.");
    await recordMemberIdentityHistory(tx, {
      memberIdentityId: identityId, action: "DETACH", before: identity,
      after: { memberId: null, verificationStatus: "UNVERIFIED" }, reason, actionById: userId, actionAt: now
    });
    await reconcileTimeBasedCoverageForIdentity(tx, identityId, userId);
    await synchronizePendingTimeBasedForMember(tx, memberId, userId);
  });
}

export function updateIdentityMetadata(memberId: string, identityId: string, input: IdentityMetadataInput, userId: string) {
  return memberTransaction(async tx => {
    const identity = await identityState(tx, identityId);
    if (identity.memberId !== memberId || identity.verificationStatus !== "VERIFIED") throw new HttpError(409, "Identitas bukan lagi milik donatur ini. Muat ulang data.");
    const result = await tx.memberIdentity.updateMany({
      where: { id: identityId, memberId, verificationStatus: "VERIFIED" }, data: { ...input, updatedById: userId }
    });
    if (result.count !== 1) throw new HttpError(409, "Identitas berubah saat disimpan. Muat ulang data.");
  });
}
