import { currentBusinessDayValue, currentBusinessMonthValue } from "../../../lib/business-time.js";
import { HttpError } from "../../../lib/http.js";
import { resolvePeriod } from "../../../lib/period.js";
import { memberTransaction } from "../member-identity/member-transaction.js";
import { manuallyAllocateTimeBasedPayment, rebuildTimeBasedSubscription, synchronizePendingTimeBasedForMember } from "../time-based/member-time-based.service.js";
import { resolveTimeBasedUnits } from "../../reconciliation/time-based-classification.js";
import { decimalStringToCents } from "../../reconciliation/reconciliation-classification.js";
import { deriveAge } from "./member-data.domain.js";
import { aggregateCategories, centsToDecimal } from "./member-donation.domain.js";
import * as repository from "./member-data.repository.js";
import type { IdentityHistoryQuery, IdentityMetadataInput, MemberDataWorkspaceQuery, MemberDonationQuery, MemberProfileInput, OpeningCoverageInput, SubscriptionCreateInput, SubscriptionUpdateInput } from "./member-data.schema.js";

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

export function sponsorshipStatus(item: { activeFlag: boolean; startDate: Date | null; validUntil: Date | null }) {
  const today = currentBusinessDayValue();
  if (!item.activeFlag) return "INACTIVE";
  if (!item.validUntil) return "PENDING";
  if (item.startDate && dateOnly(item.startDate)! > today) return "SCHEDULED";
  if (item.validUntil && dateOnly(item.validUntil)! < today) return "EXPIRED";
  return "ACTIVE";
}

export async function getSponsorship(memberId: string) {
  const result = await repository.loadMemberSponsorship(memberId);
  if (!result.member) throw new HttpError(404, "Donatur tidak ditemukan.");
  const subscriptions = result.subscriptions.map(item => ({
    subscriptionId: item.id, event: { eventCodeId: item.eventCode.id, code: item.eventCode.code, eventName: item.eventCode.eventName }, referenceNo: item.referenceNo,
    displayName: item.displayName, startDate: dateOnly(item.startDate), validUntil: dateOnly(item.validUntil), activeFlag: item.activeFlag, remark: item.remark,
    status: sponsorshipStatus(item), coverage: item.coverages.map(coverage => ({ coverageId: coverage.id, source: coverage.coverageSource, status: coverage.coverageStatus,
      transactionId: coverage.bankTransactionId, transactionDate: dateOnly(coverage.bankTransaction?.transactionDate ?? null), referenceNo: coverage.bankTransaction?.referenceNo ?? null,
      amountApplied: coverage.amountApplied?.toString() ?? null, unitAmount: coverage.unitAmountSnapshot?.toString() ?? null,
      durationMonths: coverage.durationMonthsSnapshot, grantedUnits: coverage.grantedUnits, coverageFrom: dateOnly(coverage.coverageFrom), coverageTo: dateOnly(coverage.coverageTo),
      remark: coverage.remark, voidReason: coverage.voidReason }))
  }));
  return { subscriptions, eventOptions: result.eventOptions.map(event => ({ eventCodeId: event.id, code: event.code, eventName: event.eventName })), pendingPayments: result.pending.map(payment => {
    let estimate: ReturnType<typeof resolveTimeBasedUnits> = null;
    try { estimate = resolveTimeBasedUnits({ eventCode: { eventType: "TIME_BASED" }, rule: payment.eventCode?.timeRule ?? null, transaction: payment, requiresClassification: true }); }
    catch (caught) { const reason = caught instanceof Error ? caught.message : "Time Rule cannot resolve this payment"; return { transactionId: payment.id, transactionDate: dateOnly(payment.transactionDate), referenceNo: payment.referenceNo, amount: payment.originalAmount.toString(), principalAmount: (payment.baseAmount ?? payment.originalAmount).toString(), event: payment.eventCode ? { eventCodeId: payment.eventCode.id, code: payment.eventCode.code, eventName: payment.eventCode.eventName } : null, grantedUnits: null, durationMonths: null, reason }; }
    const matching = subscriptions.filter(subscription => subscription.event.eventCodeId === payment.eventCode?.id && subscription.activeFlag);
    const reason = matching.length === 0 ? "No active subscription for this Event Code"
      : matching.length > 1 ? "Multiple active subscriptions — choose one"
        : "Allocation pending synchronization";
    return { transactionId: payment.id, transactionDate: dateOnly(payment.transactionDate), referenceNo: payment.referenceNo, amount: payment.originalAmount.toString(), principalAmount: (payment.baseAmount ?? payment.originalAmount).toString(), event: payment.eventCode ? { eventCodeId: payment.eventCode.id, code: payment.eventCode.code, eventName: payment.eventCode.eventName } : null, grantedUnits: estimate?.grantedUnits ?? null, durationMonths: estimate?.durationMonths ?? null, reason };
  }) };
}

export async function createSubscription(memberId: string, input: SubscriptionCreateInput, userId: string) {
  await memberTransaction(async tx => {
    const [member, event] = await Promise.all([tx.member.findUnique({ where: { id: memberId }, select: { activeFlag: true } }), tx.eventCode.findUnique({ where: { id: input.eventCodeId }, select: { eventType: true, activeFlag: true } })]);
    if (!member?.activeFlag) throw new HttpError(400, "Active Member is required for a sponsorship subscription");
    if (!event || event.eventType !== "TIME_BASED" || !event.activeFlag) throw new HttpError(400, "Choose an active TIME_BASED Event Code");
    await tx.memberEventSubscription.create({ data: { memberId, eventCodeId: input.eventCodeId, referenceNo: input.referenceNo, displayName: input.displayName, startDate: input.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : null, activeFlag: input.activeFlag, remark: input.remark, createdById: userId, updatedById: userId } });
    if (input.activeFlag) await synchronizePendingTimeBasedForMember(tx, memberId, userId, input.eventCodeId);
  });
  return getSponsorship(memberId);
}

export async function updateSubscription(memberId: string, subscriptionId: string, input: SubscriptionUpdateInput, userId: string) {
  await memberTransaction(async tx => {
    const sub = await tx.memberEventSubscription.findUnique({ where: { id: subscriptionId }, select: { memberId: true } });
    if (!sub || sub.memberId !== memberId) throw new HttpError(404, "Sponsorship subscription not found");
    await tx.memberEventSubscription.update({ where: { id: subscriptionId }, data: { referenceNo: input.referenceNo, displayName: input.displayName, startDate: input.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : null, activeFlag: input.activeFlag, remark: input.remark, updatedById: userId } });
  });
  return getSponsorship(memberId);
}

export async function allocateSubscription(memberId: string, subscriptionId: string, transactionId: string, userId: string) {
  await memberTransaction(tx => manuallyAllocateTimeBasedPayment(tx, { memberId, subscriptionId, transactionId, userId }));
  return getSponsorship(memberId);
}

export async function addOpeningCoverage(memberId: string, subscriptionId: string, input: OpeningCoverageInput, userId: string) {
  await memberTransaction(async tx => {
    const sub = await tx.memberEventSubscription.findUnique({ where: { id: subscriptionId }, select: { id: true, memberId: true } });
    if (!sub || sub.memberId !== memberId) throw new HttpError(404, "Sponsorship subscription not found");
    const from = new Date(`${input.coverageFrom}T00:00:00.000Z`); const to = new Date(`${input.coverageTo}T00:00:00.000Z`);
    await tx.memberEventCoverage.create({ data: { subscriptionId, coverageSource: "OPENING", coverageStatus: "ACTIVE", coverageFrom: from, coverageTo: to, remark: input.remark, createdById: userId } });
    await rebuildTimeBasedSubscription(tx, subscriptionId, userId, "Coverage chain rebuilt after opening coverage was recorded");
  });
  return getSponsorship(memberId);
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
