import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { HttpError } from "../../../lib/http.js";
import { memberTransaction } from "../member-identity/member-transaction.js";
import type { IdentityMetadataInput, MemberDataWorkspaceQuery, MemberProfileInput } from "./member-data.schema.js";
import { detachedIdentityData, verifiedIdentityData } from "./member-data.domain.js";

export type MemberDonationFilter = { periodStart: Date; periodEnd: Date; eventCodeId?: string };

const actorSelect = { id: true, fullName: true } as const;
const memberListSelect = {
  id: true, memberCode: true, memberName: true, initialName: true, birthDate: true,
  phone: true, email: true, city: true, registrationSource: true, activeFlag: true,
  registeredAt: true, _count: { select: { identities: true } }
} as const;

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
    const [total, active, inactive, manual, statement, cities, eventOptions] = await Promise.all([
      tx.member.count({ where }), tx.member.count({ where: { activeFlag: true } }),
      tx.member.count({ where: { activeFlag: false } }), tx.member.count({ where: { registrationSource: "MANUAL" } }),
      tx.member.count({ where: { registrationSource: "STATEMENT" } }),
      tx.member.findMany({ where: { city: { not: null } }, distinct: ["city"], select: { city: true }, orderBy: { city: "asc" } }),
      tx.eventCode.findMany({ where: { activeFlag: true }, select: { id: true, code: true, eventName: true, category: true }, orderBy: [{ code: "asc" }, { eventName: "asc" }] })
    ]);
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const rows = await tx.member.findMany({
      where, skip: (page - 1) * query.pageSize, take: query.pageSize,
      orderBy: [{ registeredAt: "desc" }, { id: "asc" }], select: memberListSelect
    });
    return { rows, total, page, summary: { total: active + inactive, active, inactive, manual, statement }, cities: cities.flatMap(row => row.city ? [row.city] : []), eventOptions };
  });
}

const officialDonationWhere = (identityIds: string[]): Prisma.BankTransactionWhereInput => ({
  memberIdentityId: { in: identityIds }, status: "FINALIZED", originalAmount: { gt: 0 }, eventCodeId: { not: null }
});

export async function loadWorkspaceDonationAnalytics(memberIds: string[], filter: MemberDonationFilter) {
  if (!memberIds.length) return { identities: [], lifetime: [], period: [] };
  const identities = await prisma.memberIdentity.findMany({
    where: { memberId: { in: memberIds }, verificationStatus: "VERIFIED" }, select: { id: true, memberId: true }
  });
  const identityIds = identities.map(identity => identity.id);
  if (!identityIds.length) return { identities, lifetime: [], period: [] };
  const base = officialDonationWhere(identityIds);
  const [lifetime, period] = await Promise.all([
    prisma.bankTransaction.groupBy({ by: ["memberIdentityId"], where: base, _sum: { originalAmount: true }, _count: { _all: true } }),
    prisma.bankTransaction.groupBy({ by: ["memberIdentityId"], where: { AND: [base, {
      transactionDate: { gte: filter.periodStart, lt: filter.periodEnd }, ...(filter.eventCodeId ? { eventCodeId: filter.eventCodeId } : {})
    }] }, _sum: { originalAmount: true }, _count: { _all: true } })
  ]);
  return { identities, lifetime, period };
}

export async function loadMemberDonationRecords(memberId: string, filter: MemberDonationFilter, page: number, pageSize: number) {
  const relation: Prisma.BankTransactionWhereInput = {
    memberIdentity: { is: { memberId, verificationStatus: "VERIFIED" } },
    status: "FINALIZED", originalAmount: { gt: 0 }, eventCodeId: { not: null }
  };
  const periodWhere: Prisma.BankTransactionWhereInput = { AND: [relation, {
    transactionDate: { gte: filter.periodStart, lt: filter.periodEnd }, ...(filter.eventCodeId ? { eventCodeId: filter.eventCodeId } : {})
  }] };
  const [member, lifetime, period, total, rows, eventGroups, eventOptions] = await Promise.all([
    prisma.member.findUnique({ where: { id: memberId }, select: { id: true, memberCode: true, memberName: true } }),
    prisma.bankTransaction.aggregate({ where: relation, _sum: { originalAmount: true }, _count: { _all: true } }),
    prisma.bankTransaction.aggregate({ where: periodWhere, _sum: { originalAmount: true }, _count: { _all: true } }),
    prisma.bankTransaction.count({ where: periodWhere }),
    prisma.bankTransaction.findMany({
      where: periodWhere, skip: (page - 1) * pageSize, take: pageSize,
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: { id: true, transactionDate: true, referenceNo: true, description: true, originalAmount: true,
        memberIdentity: { select: { id: true, accountName: true, initialName: true, sourceType: true } },
        eventCode: { select: { id: true, code: true, eventName: true, category: true } },
        statementUpload: { select: { id: true, fileName: true } } }
    }),
    prisma.bankTransaction.groupBy({ by: ["eventCodeId"], where: periodWhere,
      _sum: { originalAmount: true }, _count: { _all: true }, orderBy: { _sum: { originalAmount: "desc" } } }),
    prisma.eventCode.findMany({ where: { activeFlag: true }, select: { id: true, code: true, eventName: true, category: true }, orderBy: [{ code: "asc" }, { eventName: "asc" }] })
  ]);
  const eventIds = eventGroups.flatMap(group => group.eventCodeId ? [group.eventCodeId] : []);
  const events = eventIds.length ? await prisma.eventCode.findMany({
    where: { id: { in: eventIds } }, select: { id: true, code: true, eventName: true, category: true }
  }) : [];
  return { member, lifetime, period, total, rows, eventGroups, events, eventOptions };
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
    const result = await tx.memberIdentity.updateMany({
      where: { id: identityId, memberId: null, verificationStatus: "UNVERIFIED" },
      data: verifiedIdentityData(memberId, userId, new Date())
    });
    if (result.count !== 1) throw new HttpError(409, "Identitas berubah saat diproses. Muat ulang data donatur.");
  });
}

export function moveIdentity(sourceMemberId: string, identityId: string, destinationMemberId: string, userId: string) {
  if (sourceMemberId === destinationMemberId) throw new HttpError(400, "Donatur tujuan harus berbeda.");
  return memberTransaction(async tx => {
    await requireActiveMember(tx, destinationMemberId);
    const identity = await identityState(tx, identityId);
    if (identity.memberId !== sourceMemberId || identity.verificationStatus !== "VERIFIED") throw new HttpError(409, "Identitas bukan lagi milik donatur ini. Muat ulang data.");
    const result = await tx.memberIdentity.updateMany({
      where: { id: identityId, memberId: sourceMemberId, verificationStatus: "VERIFIED" },
      data: verifiedIdentityData(destinationMemberId, userId, new Date())
    });
    if (result.count !== 1) throw new HttpError(409, "Identitas berubah saat dipindahkan. Muat ulang data.");
  });
}

export function detachIdentity(memberId: string, identityId: string, userId: string) {
  return memberTransaction(async tx => {
    const identity = await identityState(tx, identityId);
    if (identity.memberId !== memberId || identity.verificationStatus !== "VERIFIED") throw new HttpError(409, "Identitas bukan lagi milik donatur ini. Muat ulang data.");
    const result = await tx.memberIdentity.updateMany({
      where: { id: identityId, memberId, verificationStatus: "VERIFIED" },
      data: detachedIdentityData(userId)
    });
    if (result.count !== 1) throw new HttpError(409, "Identitas berubah saat dilepas. Muat ulang data.");
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
