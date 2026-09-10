import { currentBusinessDayValue, currentBusinessMonthValue } from "../../../lib/business-time.js";
import { HttpError } from "../../../lib/http.js";
import { resolvePeriod } from "../../../lib/period.js";
import { decimalStringToCents } from "../../reconciliation/reconciliation-classification.js";
import { deriveAge } from "./member-data.domain.js";
import { aggregateCategories, centsToDecimal } from "./member-donation.domain.js";
import * as repository from "./member-data.repository.js";
import type { IdentityHistoryQuery, IdentityMetadataInput, MemberDataWorkspaceQuery, MemberDonationQuery, MemberProfileInput } from "./member-data.schema.js";

const dateOnly = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
function listMember(row: Awaited<ReturnType<typeof repository.workspaceRecords>>["rows"][number]) {
  const { id, birthDate, _count, ...member } = row;
  return { ...member, memberId: id, birthDate: dateOnly(birthDate), age: deriveAge(birthDate, currentBusinessDayValue()), identityCount: _count.identities };
}

export async function getWorkspace(query: MemberDataWorkspaceQuery) {
  const result = await repository.workspaceRecords(query);
  const analytics = await repository.loadWorkspaceDonationAnalytics(result.rows.map(row => row.id));
  const identityMembers = new Map(analytics.identities.map(identity => [identity.id, identity.memberId!]));
  const lifetime = donationTotalsByMember(analytics.lifetime, identityMembers);
  return {
    summary: result.summary,
    filters: { cities: result.cities },
    rows: result.rows.map(row => ({ ...listMember(row), lifetimeDonation: lifetime.get(row.id)?.amount ?? "0.00",
      lifetimeTransactions: lifetime.get(row.id)?.transactionCount ?? 0 })),
    pagination: { page: result.page, pageSize: query.pageSize, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)) }
  };
}

function donationPeriod(query: Pick<MemberDonationQuery, "periodMode" | "month" | "date">) {
  const month = query.month ?? currentBusinessMonthValue();
  const date = query.date ?? (query.periodMode === "DAY" ? currentBusinessDayValue() : `${month}-01`);
  return resolvePeriod(query.periodMode, month, date);
}

function donationTotalsByMember(groups: Array<{ memberIdentityId: string | null; _sum: { originalAmount: { toString(): string } | null }; _count: { _all: number } }>, identityMembers: Map<string, string>) {
  const totals = new Map<string, { cents: bigint; amount: string; transactionCount: number }>();
  for (const group of groups) {
    const memberId = group.memberIdentityId ? identityMembers.get(group.memberIdentityId) : undefined;
    if (!memberId) continue;
    const current = totals.get(memberId) ?? { cents: 0n, amount: "0.00", transactionCount: 0 };
    current.cents += decimalStringToCents(group._sum.originalAmount?.toString() ?? "0");
    current.amount = centsToDecimal(current.cents);
    current.transactionCount += group._count._all;
    totals.set(memberId, current);
  }
  return totals;
}

export async function getDetail(memberId: string) {
  const row = await repository.findMemberDetail(memberId);
  if (!row) throw new HttpError(404, "Donatur tidak ditemukan.");
  const { id, birthDate, identities, ...member } = row;
  return { ...member, memberId: id, birthDate: dateOnly(birthDate), age: deriveAge(birthDate, currentBusinessDayValue()),
    identities: identities.map(({ id: identityId, _count, ...identity }) => ({ ...identity, memberIdentityId: identityId, transactionCount: _count.transactions })) };
}

export async function getIdentityHistory(memberId: string, query: IdentityHistoryQuery) {
  const result = await repository.loadIdentityHistory(memberId, query.page, query.pageSize);
  if (!result.member) throw new HttpError(404, "Donatur tidak ditemukan.");
  return {
    rows: result.rows.map(row => ({
      historyId: row.id,
      action: row.action,
      statusBefore: row.statusBefore,
      statusAfter: row.statusAfter,
      reason: row.reason,
      actionAt: row.actionAt,
      actionBy: row.actionBy,
      identity: {
        memberIdentityId: row.memberIdentity.id,
        accountName: row.memberIdentity.accountName,
        sourceType: row.memberIdentity.sourceType,
        bankName: row.memberIdentity.bankName,
        accountNumber: row.memberIdentity.accountNumber
      },
      fromMember: row.fromMember ? { memberId: row.fromMember.id, memberCode: row.fromMember.memberCode, memberName: row.fromMember.memberName } : null,
      toMember: row.toMember ? { memberId: row.toMember.id, memberCode: row.toMember.memberCode, memberName: row.toMember.memberName } : null
    })),
    pagination: { page: result.page, pageSize: query.pageSize, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)) }
  };
}

export async function getIdentityOptions(search: string) {
  return (await repository.findIdentityOptions(search)).map(({ id, _count, ...row }) => ({ ...row, memberIdentityId: id, transactionCount: _count.transactions }));
}

export async function getMemberOptions(search: string, excludeMemberId?: string) {
  return (await repository.findActiveMemberOptions(search, excludeMemberId)).map(({ id, ...row }) => ({ ...row, memberId: id }));
}

export async function updateProfile(memberId: string, input: MemberProfileInput, userId: string) {
  const row = await repository.updateMember(memberId, input, userId);
  return listMember(row);
}

export async function updateLifecycle(memberId: string, activeFlag: boolean, userId: string) {
  return listMember(await repository.updateMemberLifecycle(memberId, activeFlag, userId));
}

export async function attach(memberId: string, identityId: string, userId: string) {
  await repository.attachIdentity(memberId, identityId, userId);
  return { message: "Identitas berhasil ditambahkan." };
}
export async function move(memberId: string, identityId: string, destinationMemberId: string, reason: string, userId: string) {
  await repository.moveIdentity(memberId, identityId, destinationMemberId, reason, userId);
  return { message: "Identitas berhasil dipindahkan." };
}
export async function detach(memberId: string, identityId: string, reason: string, userId: string) {
  await repository.detachIdentity(memberId, identityId, reason, userId);
  return { message: "Identitas dilepas dan kembali ke Registrasi Donatur." };
}
export async function updateIdentity(memberId: string, identityId: string, input: IdentityMetadataInput, userId: string) {
  await repository.updateIdentityMetadata(memberId, identityId, input, userId);
  return { message: "Metadata identitas berhasil disimpan." };
}

export async function getDonations(memberId: string, query: MemberDonationQuery) {
  const period = donationPeriod(query);
  const result = await repository.loadMemberDonationRecords(memberId, {
    periodStart: period.start, periodEnd: period.end, eventCodeId: query.eventCodeId, search: query.search
  }, query.page, query.pageSize);
  if (!result.member) throw new HttpError(404, "Donatur tidak ditemukan.");
  const events = new Map(result.events.map(event => [event.id, event]));
  const eventBreakdown = result.eventGroups.flatMap(group => {
    const event = group.eventCodeId ? events.get(group.eventCodeId) : undefined;
    return event ? [{ eventCodeId: event.id, eventCode: event.code, eventName: event.eventName, category: event.category?.trim() || "Uncategorized",
      transactionCount: group._count._all, amount: group._sum.originalAmount?.toString() ?? "0.00" }] : [];
  });
  return {
    member: { memberId: result.member.id, memberCode: result.member.memberCode, memberName: result.member.memberName },
    filters: { periodMode: period.mode, month: period.month, date: period.date, eventCodeId: query.eventCodeId ?? null, search: query.search },
    summary: { lifetimeAmount: result.lifetime._sum.originalAmount?.toString() ?? "0.00", lifetimeTransactionCount: result.lifetime._count._all,
      periodAmount: result.period._sum.originalAmount?.toString() ?? "0.00", periodTransactionCount: result.period._count._all },
    rows: result.rows.map(row => ({
      transactionId: row.id,
      transactionDate: row.transactionDate,
      sourceType: row.sourceType,
      correctionReason: row.correctionReason,
      manualAddedAt: row.manualAddedAt,
      manualAddedBy: row.manualAddedBy,
      identity: row.memberIdentity ? { memberIdentityId: row.memberIdentity.id, accountName: row.memberIdentity.accountName,
        initialName: row.memberIdentity.initialName, sourceType: row.memberIdentity.sourceType } : null,
      referenceNo: row.referenceNo, description: row.description, amount: row.originalAmount.toString(),
      finalEvent: row.eventCode ? { eventCodeId: row.eventCode.id, eventCode: row.eventCode.code, eventName: row.eventCode.eventName,
        category: row.eventCode.category?.trim() || "Uncategorized" } : null,
      statement: { statementId: row.statementUpload.id, fileName: row.statementUpload.fileName }
    })),
    eventBreakdown,
    categoryBreakdown: aggregateCategories(eventBreakdown.map(row => ({ category: row.category, transactionCount: row.transactionCount, amount: row.amount }))),
    eventOptions: result.eventOptions,
    pagination: { page: result.page, pageSize: query.pageSize, totalRows: result.total, totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)) }
  };
}
