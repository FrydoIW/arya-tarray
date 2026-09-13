import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../lib/prisma.js";
import { HttpError } from "../../../lib/http.js";
import { memberTransaction } from "../member-identity/member-transaction.js";
import { recordMemberIdentityHistory } from "../member-identity/member-identity-history.js";
import { synchronizePendingTimeBasedForMember } from "../time-based/member-time-based.service.js";
import type { MemberInput, WorkspaceQuery } from "./member-registration.schema.js";

const memberSelect = { id: true, memberCode: true, memberName: true, initialName: true, city: true, activeFlag: true } as const;
export async function workspaceRecords(query: WorkspaceQuery) {
  const where: Prisma.MemberIdentityWhereInput = {
    ...(query.status !== "ALL" ? { verificationStatus: query.status } : {}),
    ...(query.search ? { OR: [
      { accountName: { contains: query.search } }, { initialName: { contains: query.search } },
      { normalizedName: { contains: query.search } },
      { member: { is: { OR: [{ memberName: { contains: query.search } }, { memberCode: { contains: query.search } }] } } }
    ] } : {})
  };
  return prisma.$transaction(async tx => {
    const [total, counts] = await Promise.all([
      tx.memberIdentity.count({ where }),
      tx.memberIdentity.groupBy({ by: ["verificationStatus"], _count: { _all: true } })
    ]);
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const rows = await tx.memberIdentity.findMany({
      where, skip: (page - 1) * query.pageSize, take: query.pageSize,
      orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
      select: { id: true, accountName: true, initialName: true, bankName: true, accountNumber: true,
        accountType: true, verificationStatus: true, firstSeenAt: true, lastSeenAt: true, remark: true, member: { select: memberSelect } }
    });
    const aggregates = rows.length ? await tx.bankTransaction.groupBy({
      by: ["memberIdentityId"], where: { memberIdentityId: { in: rows.map(row => row.id) } },
      _count: { _all: true }, _sum: { originalAmount: true }
    }) : [];
    return { rows, total, counts, aggregates, page };
  });
}
export function memberOptions(search: string) {
  return prisma.member.findMany({
    where: { activeFlag: true, ...(search ? { OR: [
      { memberName: { contains: search } }, { memberCode: { contains: search } },
      { initialName: { contains: search } }, { city: { contains: search } }
    ] } : {}) },
    select: memberSelect, take: 25, orderBy: [{ memberName: "asc" }, { id: "asc" }]
  });
}
async function requireCandidate(tx: Prisma.TransactionClient, identityId: string) {
  const identity = await tx.memberIdentity.findUnique({ where: { id: identityId }, select: { memberId: true, verificationStatus: true } });
  if (!identity) throw new HttpError(404, "Identitas tidak ditemukan.");
  if (identity.memberId || identity.verificationStatus !== "UNVERIFIED") throw new HttpError(409, "Identitas sudah diproses. Reload daftar registrasi.");
}
async function createMember(tx: Prisma.TransactionClient, input: MemberInput, userId: string, source: string) {
  const id = randomUUID();
  // 96 UUID bits, bounded by the physical VARCHAR(30), with a DB unique constraint as final guard.
  return tx.member.create({ data: {
    ...input, id, memberCode: "MBR-" + id.replace(/-/g, "").slice(0, 24).toUpperCase(),
    birthDate: input.birthDate ? new Date(input.birthDate + "T00:00:00.000Z") : null,
    registrationSource: source, registeredById: userId, createdById: userId, updatedById: userId
  }, select: memberSelect });
}
export function registerMember(input: MemberInput, userId: string, identityId?: string) {
  return memberTransaction(async tx => {
    if (identityId) await requireCandidate(tx, identityId);
    const member = await createMember(tx, input, userId, identityId ? "STATEMENT" : "MANUAL");
    if (identityId) {
      const now = new Date();
      const result = await tx.memberIdentity.updateMany({
        where: { id: identityId, memberId: null, verificationStatus: "UNVERIFIED" },
        data: { memberId: member.id, verificationStatus: "VERIFIED", initialName: input.initialName,
          verifiedAt: now, verifiedById: userId, updatedById: userId }
      });
      if (result.count !== 1) throw new HttpError(409, "Identitas sudah diproses. Reload daftar registrasi.");
      await recordMemberIdentityHistory(tx, {
        memberIdentityId: identityId, action: "REGISTER",
        before: { memberId: null, verificationStatus: "UNVERIFIED" },
        after: { memberId: member.id, verificationStatus: "VERIFIED" },
        actionById: userId, actionAt: now
      });
      await synchronizePendingTimeBasedForMember(tx, member.id, userId);
    }
    return member;
  });
}
export function linkMember(identityId: string, memberId: string, userId: string) {
  return memberTransaction(async tx => {
    await requireCandidate(tx, identityId);
    const member = await tx.member.findFirst({ where: { id: memberId, activeFlag: true }, select: memberSelect });
    if (!member) throw new HttpError(400, "Donatur aktif tidak ditemukan.");
    const now = new Date();
    const result = await tx.memberIdentity.updateMany({
      where: { id: identityId, memberId: null, verificationStatus: "UNVERIFIED" },
      data: { memberId, verificationStatus: "VERIFIED", verifiedAt: now, verifiedById: userId, updatedById: userId }
    });
    if (result.count !== 1) throw new HttpError(409, "Identitas sudah diproses. Reload daftar registrasi.");
    await recordMemberIdentityHistory(tx, {
      memberIdentityId: identityId, action: "LINK",
      before: { memberId: null, verificationStatus: "UNVERIFIED" },
      after: { memberId, verificationStatus: "VERIFIED" },
      actionById: userId, actionAt: now
    });
    await synchronizePendingTimeBasedForMember(tx, memberId, userId);
    return member;
  });
}
export function ignoreIdentity(identityId: string, reason: string, userId: string) {
  return memberTransaction(async tx => {
    await requireCandidate(tx, identityId);
    const now = new Date();
    const result = await tx.memberIdentity.updateMany({
      where: { id: identityId, memberId: null, verificationStatus: "UNVERIFIED" },
      data: { verificationStatus: "IGNORED", remark: reason, verifiedAt: now, verifiedById: userId, updatedById: userId }
    });
    if (result.count !== 1) throw new HttpError(409, "Identitas sudah diproses. Reload daftar registrasi.");
    await recordMemberIdentityHistory(tx, {
      memberIdentityId: identityId, action: "IGNORE",
      before: { memberId: null, verificationStatus: "UNVERIFIED" },
      after: { memberId: null, verificationStatus: "IGNORED" },
      reason, actionById: userId, actionAt: now
    });
    return { message: "Identitas diabaikan." };
  });
}
