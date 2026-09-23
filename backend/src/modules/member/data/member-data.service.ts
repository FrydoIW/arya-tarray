import { Prisma } from "@prisma/client";
import { currentBusinessDayValue, currentBusinessMonthValue } from "../../../lib/business-time.js";
import { HttpError } from "../../../lib/http.js";
import { resolvePeriod } from "../../../lib/period.js";
import { memberTransaction } from "../member-identity/member-transaction.js";
import { lockActiveTimeBasedProgram, manuallyAllocateTimeBasedPayment, rebuildTimeBasedSubscription, resolveEffectiveStartDate, selectHistoricalCoverageEntitlement, selectHistoricalPaymentSnapshot, synchronizePendingTimeBasedForMember, synchronizeTimeBasedTransaction } from "../time-based/member-time-based.service.js";
import { resolveTimeBasedUnits } from "../../reconciliation/time-based-classification.js";
import { decimalStringToCents } from "../../reconciliation/reconciliation-classification.js";
import { campaignDisplayStatus } from "../../configuration/event-code/event-campaign.service.js";
import { canonicalMemberDonationWhere } from "../member-donation.rules.js";
import { deriveAge } from "./member-data.domain.js";
import { aggregateCategories, centsToDecimal } from "./member-donation.domain.js";
import * as repository from "./member-data.repository.js";
import type { CampaignParticipationCreateInput, IdentityHistoryQuery, IdentityMetadataInput, MemberDataWorkspaceQuery, MemberDonationQuery, MemberProfileInput, OpeningCoverageInput, SubscriptionCreateInput, SubscriptionUpdateInput } from "./member-data.schema.js";

type SubscriptionMetadataUpdateInput = SubscriptionUpdateInput & {
  /** Legacy callers may still provide lifecycle fields; normal API validation rejects them. */
  startDate?: string | null;
  activeFlag?: boolean;
};

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

export function sponsorshipStatus(item: { activeFlag: boolean }) {
  return item.activeFlag ? "ACTIVE" : "INACTIVE";
}

export function initialTimeBasedSubscriptionState() {
  return { activeFlag: true as const, startDate: null };
}

export function pendingTimeBasedPaymentPreview(payment: {
  id: string; transactionDate: Date | null; referenceNo: string | null;
  originalAmount: { toString(): string }; baseAmount: { toString(): string } | null;
  eventCode: { id: string; code: string; eventName: string; timeRule: { unitAmount: { toString(): string }; durationMonths: number; activeFlag: boolean } | null } | null;
  memberEventCoverages: Array<{ coverageStatus: string; unitAmountSnapshot: { toString(): string } | null; durationMonthsSnapshot: number | null; grantedUnits: number | null; amountApplied: { toString(): string } | null; subscription: { eventCodeId: string } }>;
  memberEventBalanceLedger?: Array<{ entryType: string; amountDelta: { toString(): string }; unitAmountSnapshot: { toString(): string } | null; durationMonthsSnapshot: number | null; subscription: { eventCodeId: string } }>;
}, subscriptions: Array<{ event: { eventCodeId: string }; activeFlag: boolean }>) {
  let estimate: ReturnType<typeof resolveTimeBasedUnits> = null;
  const ledgerSnapshot = selectHistoricalPaymentSnapshot({ eventCodeId: payment.eventCode?.id ?? null,
    principalAmount: payment.originalAmount, alternativePrincipalAmount: payment.baseAmount, recalculate: false, entries: payment.memberEventBalanceLedger ?? [] });
  const coverageSnapshot = selectHistoricalCoverageEntitlement({ eventCodeId: payment.eventCode?.id ?? null,
    principalAmount: payment.originalAmount, alternativePrincipalAmount: payment.baseAmount, recalculate: false,
    coverages: payment.memberEventCoverages.map(row => ({ coverageStatus: row.coverageStatus, subscriptionEventCodeId: row.subscription.eventCodeId, unitAmount: row.unitAmountSnapshot, durationMonths: row.durationMonthsSnapshot, grantedUnits: row.grantedUnits, amountApplied: row.amountApplied })) });
  try {
    const historical = ledgerSnapshot ?? coverageSnapshot;
    const resolved = historical
      ? resolveTimeBasedUnits({ eventCode: { eventType: "TIME_BASED" }, rule: { unitAmount: { toString: () => historical.unitAmount }, durationMonths: historical.durationMonths, activeFlag: true }, transaction: payment, requiresClassification: true })
      : resolveTimeBasedUnits({ eventCode: { eventType: "TIME_BASED" }, rule: payment.eventCode?.timeRule ?? null, transaction: payment, requiresClassification: true });
    if (resolved) {
      const unit = decimalStringToCents(resolved.unitAmount);
      const amount = decimalStringToCents(payment.originalAmount.toString());
      const units = amount / unit;
      if (units > 2_147_483_647n) throw new Error("TIME_BASED amount resolves to an invalid number of units");
      estimate = { ...resolved, grantedUnits: Number(units), amountApplied: payment.originalAmount.toString() };
    }
  }
  catch (caught) { const reason = caught instanceof Error ? caught.message : "Time Rule cannot resolve this payment"; return { transactionId: payment.id, transactionDate: dateOnly(payment.transactionDate), referenceNo: payment.referenceNo, amount: payment.originalAmount.toString(), principalAmount: payment.originalAmount.toString(), event: payment.eventCode ? { eventCodeId: payment.eventCode.id, code: payment.eventCode.code, eventName: payment.eventCode.eventName } : null, unitAmount: null, grantedUnits: null, durationMonths: null, reason }; }
  const matching = subscriptions.filter(subscription => subscription.event.eventCodeId === payment.eventCode?.id && subscription.activeFlag);
  const reason = matching.length === 0 ? "No active subscription for this Event Code"
    : matching.length > 1 ? "Multiple active subscriptions — choose one"
      : "Allocation pending synchronization";
  return { transactionId: payment.id, transactionDate: dateOnly(payment.transactionDate), referenceNo: payment.referenceNo, amount: payment.originalAmount.toString(), principalAmount: payment.originalAmount.toString(), event: payment.eventCode ? { eventCodeId: payment.eventCode.id, code: payment.eventCode.code, eventName: payment.eventCode.eventName } : null, unitAmount: estimate?.unitAmount ?? null, grantedUnits: estimate?.grantedUnits ?? null, durationMonths: estimate?.durationMonths ?? null, reason };
}

export type SubscriptionLedgerTotals = { principal: bigint; consumed: bigint; transferIn: bigint; transferOut: bigint; carry: bigint };

/** Read-model reduction of ACTIVE ledger rows per subscription. Never a source of financial truth. */
export function summarizeSubscriptionLedger(rows: Array<{ subscriptionId: string; entryType: string; _sum: { amountDelta: { toString(): string } | null } }>) {
  const totals = new Map<string, SubscriptionLedgerTotals>();
  for (const row of rows) {
    const current = totals.get(row.subscriptionId) ?? { principal: 0n, consumed: 0n, transferIn: 0n, transferOut: 0n, carry: 0n };
    const amount = decimalStringToCents(row._sum.amountDelta?.toString() ?? "0");
    if (row.entryType === "PAYMENT") current.principal += amount;
    else if (row.entryType === "COVERAGE_USE") current.consumed += -amount;
    else if (row.entryType === "TRANSFER_IN") current.transferIn += amount;
    else if (row.entryType === "TRANSFER_OUT") current.transferOut += -amount;
    current.carry += amount;
    totals.set(row.subscriptionId, current);
  }
  return totals;
}

export function summarizeContributions(input: {
  groups: Array<{ eventCodeId: string | null; eventCampaignId: string | null; _sum: { originalAmount: { toString(): string } | null }; _count: { _all: number } }>;
  events: Array<{ id: string; code: string; eventName: string; eventType: string; category: string | null }>;
  campaigns: Array<{ id: string; eventCodeId: string; campaignName: string; activeFlag: boolean; startDate: Date | null; endDate: Date | null }>;
  today?: string;
}) {
  const eventById = new Map(input.events.map(event => [event.id, event]));
  const campaignById = new Map(input.campaigns.map(campaign => [campaign.id, campaign]));
  return input.groups.flatMap(group => {
    const event = group.eventCodeId ? eventById.get(group.eventCodeId) : undefined;
    if (!event) return [];
    const campaign = group.eventCampaignId ? campaignById.get(group.eventCampaignId) : undefined;
    return [{
      eventCodeId: event.id, eventCode: event.code, eventName: event.eventName, eventType: event.eventType,
      category: event.category?.trim() || "Uncategorized",
      campaign: campaign ? { campaignId: campaign.id, campaignName: campaign.campaignName,
        displayStatus: campaignDisplayStatus(campaign, input.today) } : null,
      totalAmount: centsToDecimal(decimalStringToCents(group._sum.originalAmount?.toString() ?? "0")),
      transactionCount: group._count._all
    }];
  }).sort((a, b) => a.eventCode.localeCompare(b.eventCode) || (a.campaign?.campaignName ?? "").localeCompare(b.campaign?.campaignName ?? ""));
}

export function summarizeCampaignAllocations(input: {
  contributions: ReturnType<typeof summarizeContributions>;
  participations?: Array<{ eventCampaignId: string }>;
  allocations: Array<{ id: string; eventCampaignId: string; amountDelta: { toString(): string }; allocationType: string; allocationStatus: string; effectiveDate: Date; reason: string;
    eventCampaign: { id: string; campaignName: string; eventCodeId: string; targetAmount: { toString(): string } | null; activeFlag: boolean; startDate: Date | null; endDate: Date | null;
      eventCode: { code: string; eventName: string; eventType: string; activeFlag: boolean } } }>;
  campaignMasters: Array<{ id: string; campaignName: string; eventCodeId: string; targetAmount: { toString(): string } | null; activeFlag: boolean; startDate: Date | null; endDate: Date | null;
    eventCode: { code: string; eventName: string; eventType: string; activeFlag: boolean } }>;
  walletEntries?: Array<{ eventCampaignId: string; amountDelta: { toString(): string }; entryStatus: string }>;
  legacyContributionGroups?: Array<{ eventCampaignId: string | null; _sum: { originalAmount: { toString(): string } | null } }>;
  targetState?: Map<string, { target: bigint | null; applied: bigint }>;
  today?: string;
}) {
  const masterById = new Map(input.campaignMasters.map(campaign => [campaign.id, campaign]));
  const campaignStatus = (id: string, fallback: string) => {
    const master = masterById.get(id);
    return master ? campaignDisplayStatus({ ...master, activeFlag: master.activeFlag && master.eventCode.activeFlag }, input.today) : fallback;
  };
  type CampaignMaster = (typeof input.campaignMasters)[number];
  type Card = { campaignId: string; campaignName: string; eventCodeId: string; eventCode: string; eventName: string; status: string;
    targetAmount: bigint | null; directContribution: bigint; directApplied: bigint; allocatedFromCarry: bigint; legacyApplied: bigint; carryBalance: bigint;
    allocationHistory: Array<{ allocationId: string; amountDelta: string; allocationType: string; allocationStatus: string; effectiveDate: string; reason: string }> };
  const makeCard = (campaign: CampaignMaster, status: string): Card => ({ campaignId: campaign.id, campaignName: campaign.campaignName,
    eventCodeId: campaign.eventCodeId, eventCode: campaign.eventCode.code, eventName: campaign.eventCode.eventName, status,
    targetAmount: campaign.targetAmount ? decimalStringToCents(campaign.targetAmount.toString()) : null,
    directContribution: 0n, directApplied: 0n, allocatedFromCarry: 0n, legacyApplied: 0n, carryBalance: 0n, allocationHistory: [] });
  const byId = new Map<string, Card>();
  const ensure = (campaignId: string, fallback: string, known?: CampaignMaster) => {
    const campaign = known ?? masterById.get(campaignId);
    if (!campaign) return null;
    const current = byId.get(campaignId) ?? makeCard(campaign, campaignStatus(campaignId, fallback));
    byId.set(campaignId, current);
    return current;
  };
  for (const participation of input.participations ?? []) {
    const campaign = masterById.get(participation.eventCampaignId);
    if (!campaign) continue;
    ensure(participation.eventCampaignId, "CLOSED", campaign);
  }
  for (const row of input.contributions) {
    if (row.eventType !== "CAMPAIGN" || !row.campaign) continue;
    const master = masterById.get(row.campaign.campaignId);
    const current = ensure(row.campaign.campaignId, row.campaign.displayStatus, master);
    if (current) current.directContribution += decimalStringToCents(row.totalAmount);
  }
  for (const row of input.allocations) {
    const campaign = masterById.get(row.eventCampaignId) ?? row.eventCampaign;
    const current = ensure(row.eventCampaignId, "CLOSED", campaign);
    if (!current) continue;
    const amount = decimalStringToCents(row.amountDelta.toString());
    if (row.allocationStatus === "ACTIVE") {
      if (row.allocationType === "DIRECT_CONTRIBUTION") current.directApplied += amount;
      else current.allocatedFromCarry += amount;
    }
    current.allocationHistory.push({ allocationId: row.id, amountDelta: centsToDecimal(amount), allocationType: row.allocationType,
      allocationStatus: row.allocationStatus, effectiveDate: dateOnly(row.effectiveDate)!, reason: row.reason });
  }
  for (const row of input.legacyContributionGroups ?? []) {
    if (!row.eventCampaignId) continue;
    const current = ensure(row.eventCampaignId, "CLOSED");
    if (current) current.legacyApplied += decimalStringToCents(row._sum.originalAmount?.toString() ?? "0");
  }
  for (const row of input.walletEntries ?? []) {
    if (row.entryStatus !== "ACTIVE") continue;
    const current = ensure(row.eventCampaignId, "CLOSED");
    if (current) current.carryBalance += decimalStringToCents(row.amountDelta.toString());
  }
  for (const row of byId.values()) row.status = campaignStatus(row.campaignId, row.status);
  return [...byId.values()].map(row => {
    const target = input.targetState?.get(row.campaignId) ?? { target: row.targetAmount, applied: row.directApplied + row.allocatedFromCarry + row.legacyApplied };
    const totalAllocation = row.directApplied + row.allocatedFromCarry + row.legacyApplied;
    return { ...row, targetAmount: target.target === null ? null : centsToDecimal(target.target), targetApplied: centsToDecimal(target.applied),
      targetRemaining: target.target === null ? null : centsToDecimal(target.target > target.applied ? target.target - target.applied : 0n),
      directContribution: centsToDecimal(row.directContribution), allocatedFromCarry: centsToDecimal(row.allocatedFromCarry),
      carryBalance: centsToDecimal(row.carryBalance), totalAllocation: centsToDecimal(totalAllocation), appliedToCampaign: centsToDecimal(totalAllocation) };
  }).sort((a, b) => a.eventCode.localeCompare(b.eventCode) || a.campaignName.localeCompare(b.campaignName));
}

export function eligibleCampaignParticipationOptions<T extends { id: string; activeFlag: boolean; startDate: Date | null; endDate: Date | null; eventCode: { activeFlag: boolean } }>(
  options: T[], participatingCampaignIds: Iterable<string>, today?: string
) {
  const alreadyParticipating = new Set(participatingCampaignIds);
  return options.filter(option => !alreadyParticipating.has(option.id)
    && campaignAcceptsNewParticipation(option, option.eventCode.activeFlag, today));
}

export function campaignAcceptsNewParticipation(campaign: { activeFlag: boolean; startDate: Date | null; endDate: Date | null }, parentEventActive: boolean, today?: string) {
  return campaignDisplayStatus({ ...campaign, activeFlag: campaign.activeFlag && parentEventActive }, today) === "ACTIVE";
}

export async function getSponsorship(memberId: string) {
  const result = await repository.loadMemberSponsorship(memberId);
  if (!result.member) throw new HttpError(404, "Donatur tidak ditemukan.");
  const ledgerTotals = summarizeSubscriptionLedger(result.balances);
  const paymentDatesBySubscription = new Map<string, Date[]>();
  for (const row of result.paymentDates) {
    const dates = paymentDatesBySubscription.get(row.subscriptionId) ?? [];
    dates.push(row.effectiveDate);
    paymentDatesBySubscription.set(row.subscriptionId, dates);
  }
  const subscriptions = result.subscriptions.map(item => {
    const totals = ledgerTotals.get(item.id) ?? { principal: 0n, consumed: 0n, transferIn: 0n, transferOut: 0n, carry: 0n };
    const resolvedStartDate = resolveEffectiveStartDate({
      coverageFrom: item.coverages.filter(coverage => coverage.coverageStatus === "ACTIVE").map(coverage => coverage.coverageFrom),
      paymentDates: paymentDatesBySubscription.get(item.id) ?? []
    }) ?? item.startDate;
    return {
      subscriptionId: item.id, event: { eventCodeId: item.eventCode.id, code: item.eventCode.code, eventName: item.eventCode.eventName, eventType: item.eventCode.eventType }, referenceNo: item.referenceNo,
      displayName: item.displayName, startDate: dateOnly(resolvedStartDate), validUntil: dateOnly(item.validUntil), activeFlag: item.activeFlag, remark: item.remark,
      status: sponsorshipStatus(item),
      eventActiveFlag: item.eventCode.activeFlag,
      timeRule: item.eventCode.activeFlag && item.eventCode.timeRule?.activeFlag
        ? { unitAmount: item.eventCode.timeRule.unitAmount.toString(), durationMonths: item.eventCode.timeRule.durationMonths } : null,
      carryBalance: centsToDecimal(totals.carry),
      principal: centsToDecimal(totals.principal),
      consumed: centsToDecimal(totals.consumed),
      transferIn: centsToDecimal(totals.transferIn),
      transferOut: centsToDecimal(totals.transferOut),
      balanceHistory: item.balanceLedger.map(row => ({ ledgerId: row.id, transactionId: row.bankTransactionId, referenceNo: row.bankTransaction?.referenceNo ?? null,
        type: row.entryType, status: row.entryStatus, amountDelta: row.amountDelta.toString(), effectiveDate: dateOnly(row.effectiveDate),
        unitAmount: row.unitAmountSnapshot?.toString() ?? null, durationMonths: row.durationMonthsSnapshot, voidReason: row.voidReason })),
      coverage: item.coverages.map(coverage => ({ coverageId: coverage.id, source: coverage.coverageSource, status: coverage.coverageStatus,
        transactionId: coverage.bankTransactionId, transactionDate: dateOnly(coverage.bankTransaction?.transactionDate ?? null), referenceNo: coverage.bankTransaction?.referenceNo ?? null,
        amountApplied: coverage.amountApplied?.toString() ?? null, unitAmount: coverage.unitAmountSnapshot?.toString() ?? null,
        durationMonths: coverage.durationMonthsSnapshot, grantedUnits: coverage.grantedUnits, coverageFrom: dateOnly(coverage.coverageFrom), coverageTo: dateOnly(coverage.coverageTo),
        remark: coverage.remark, voidReason: coverage.voidReason }))
    };
  });
  const contributions = summarizeContributions({
    groups: result.contributionGroups, events: result.contributionEvents, campaigns: result.contributionCampaigns
  });
  const capacityMasterById = new Map([...result.campaignMasters, ...result.campaignOptions].map(campaign => [campaign.id, campaign]));
  const appliedByCampaign = new Map(result.campaignAppliedGroups.map(row => [row.eventCampaignId, decimalStringToCents(row._sum.amountDelta?.toString() ?? "0")]));
  const legacyAppliedByCampaign = new Map(result.campaignLegacyAppliedGroups.flatMap(row => row.eventCampaignId
    ? [[row.eventCampaignId, decimalStringToCents(row._sum.originalAmount?.toString() ?? "0")] as const] : []));
  const targetState = new Map([...capacityMasterById.values()].map(campaign => {
    const target = campaign.targetAmount ? decimalStringToCents(campaign.targetAmount.toString()) : null;
    const applied = (appliedByCampaign.get(campaign.id) ?? 0n) + (legacyAppliedByCampaign.get(campaign.id) ?? 0n);
    return [campaign.id, { target, applied }] as const;
  }));
  const campaigns = summarizeCampaignAllocations({ contributions, participations: result.campaignParticipations,
    allocations: result.campaignAllocations, campaignMasters: result.campaignMasters, walletEntries: result.campaignWalletEntries,
    legacyContributionGroups: result.legacyCampaignContributionGroups, targetState });
  const campaignParticipationOptions = eligibleCampaignParticipationOptions(result.campaignOptions, [
    ...result.contributionGroups.flatMap(row => row.eventCampaignId ? [row.eventCampaignId] : []),
    ...result.campaignAllocations.map(row => row.eventCampaignId),
    ...result.campaignParticipations.map(row => row.eventCampaignId)
  ]).filter(campaign => {
    const state = targetState.get(campaign.id);
    return !state?.target || state.applied < state.target;
  });
  const totalsByType = contributions.reduce((totals, row) => {
    const current = totals.get(row.eventType) ?? { amount: 0n, transactionCount: 0 };
    current.amount += decimalStringToCents(row.totalAmount); current.transactionCount += row.transactionCount;
    totals.set(row.eventType, current); return totals;
  }, new Map<string, { amount: bigint; transactionCount: number }>());
  const contributionTotals = Object.fromEntries(["STANDARD", "CAMPAIGN", "TIME_BASED"].map(type => {
    const value = totalsByType.get(type) ?? { amount: 0n, transactionCount: 0 };
    return [type, { amount: centsToDecimal(value.amount), transactionCount: value.transactionCount }];
  }));
  return { subscriptions, contributions, campaigns,
    availableCampaigns: result.campaignOptions.filter(campaign => {
      const state = targetState.get(campaign.id);
      return !state?.target || state.applied < state.target;
    }).map(campaign => ({ campaignId: campaign.id, campaignName: campaign.campaignName, eventCodeId: campaign.eventCodeId, code: campaign.eventCode.code, eventName: campaign.eventCode.eventName })),
    campaignParticipationOptions: campaignParticipationOptions.map(campaign => ({ campaignId: campaign.id, campaignName: campaign.campaignName,
      eventCodeId: campaign.eventCodeId, code: campaign.eventCode.code, eventName: campaign.eventCode.eventName,
      startDate: dateOnly(campaign.startDate), endDate: dateOnly(campaign.endDate) })), contributionTotals,
    eventOptions: result.eventOptions.filter(event => !subscriptions.some(subscription => subscription.event.eventCodeId === event.id))
      .map(event => ({ eventCodeId: event.id, code: event.code, eventName: event.eventName })),
    pendingPayments: result.pending.map(payment => pendingTimeBasedPaymentPreview(payment, subscriptions)) };
}

export async function createSubscription(memberId: string, input: SubscriptionCreateInput, userId: string) {
  await memberTransaction(async tx => {
    const [member, event] = await Promise.all([tx.member.findUnique({ where: { id: memberId }, select: { activeFlag: true } }), tx.eventCode.findUnique({ where: { id: input.eventCodeId }, select: { eventType: true, activeFlag: true, timeRule: { select: { activeFlag: true } } } })]);
    if (!member?.activeFlag) throw new HttpError(400, "Active Member is required for a sponsorship subscription");
    if (!event || event.eventType !== "TIME_BASED" || !event.activeFlag) throw new HttpError(400, "Choose an active TIME_BASED Event Code");
    if (!event.timeRule?.activeFlag) throw new HttpError(400, "Configure an active Time Rule before adding a subscription");
    await lockActiveTimeBasedProgram(tx, memberId, input.eventCodeId);
    const active = await tx.memberEventSubscription.findMany({ where: { memberId, eventCodeId: input.eventCodeId, activeFlag: true }, select: { id: true } });
    if (active.length) throw new HttpError(409, "An active TIME_BASED program already exists for this Member and Event Code");
    // A new program is system-active, but its effective start remains unset
    // until a finalized payment or explicit Opening Coverage supplies evidence.
    await tx.memberEventSubscription.create({ data: { memberId, eventCodeId: input.eventCodeId, referenceNo: input.referenceNo,
      displayName: input.displayName, ...initialTimeBasedSubscriptionState(), remark: input.remark, createdById: userId, updatedById: userId } });
    await synchronizePendingTimeBasedForMember(tx, memberId, userId, input.eventCodeId);
  });
  return getSponsorship(memberId);
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function createCampaignParticipationRecord(tx: Prisma.TransactionClient, memberId: string, input: CampaignParticipationCreateInput, userId: string) {
  const [member, campaign] = await Promise.all([
    tx.member.findUnique({ where: { id: memberId }, select: { activeFlag: true } }),
    tx.eventCampaign.findUnique({ where: { id: input.eventCampaignId }, select: { id: true, activeFlag: true, startDate: true, endDate: true,
      eventCode: { select: { eventType: true, activeFlag: true } } } })
  ]);
  if (!member?.activeFlag) throw new HttpError(400, "Active Member is required for Campaign participation.");
  if (!campaign || campaign.eventCode.eventType !== "CAMPAIGN"
    || !campaignAcceptsNewParticipation(campaign, campaign.eventCode.activeFlag))
    throw new HttpError(400, "Choose a Campaign that is active and within its participation period.");

  const [existing, directContribution, allocationHistory] = await Promise.all([
    tx.memberEventCampaignParticipation.findUnique({ where: { memberId_eventCampaignId: { memberId, eventCampaignId: campaign.id } }, select: { id: true } }),
    tx.bankTransaction.findFirst({ where: { ...canonicalMemberDonationWhere(memberId), eventCampaignId: campaign.id }, select: { id: true } }),
    tx.memberEventCampaignAllocation.findFirst({ where: { memberId, eventCampaignId: campaign.id }, select: { id: true } })
  ]);
  if (existing || directContribution || allocationHistory)
    throw new HttpError(409, "Donatur sudah berpartisipasi pada Campaign ini.");

  try {
    await tx.memberEventCampaignParticipation.create({ data: { memberId, eventCampaignId: campaign.id,
      activeFlag: true, remark: input.remark, createdById: userId } });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new HttpError(409, "Donatur sudah berpartisipasi pada Campaign ini.");
    throw error;
  }
}

export async function createCampaignParticipation(memberId: string, input: CampaignParticipationCreateInput, userId: string) {
  await memberTransaction(tx => createCampaignParticipationRecord(tx, memberId, input, userId));
  return getSponsorship(memberId);
}

export async function updateSubscriptionRecord(tx: Prisma.TransactionClient, memberId: string, subscriptionId: string, input: SubscriptionMetadataUpdateInput, userId: string) {
    const sub = await tx.memberEventSubscription.findUnique({ where: { id: subscriptionId }, select: { memberId: true, eventCodeId: true, startDate: true, activeFlag: true } });
    if (!sub || sub.memberId !== memberId) throw new HttpError(404, "Sponsorship subscription not found");
    if (input.activeFlag !== undefined)
      throw new HttpError(409, "Status Program dikelola otomatis oleh sistem.");
    if (input.startDate !== undefined && dateOnly(sub.startDate) !== input.startDate) {
      const [coverage, payment] = await Promise.all([
        tx.memberEventCoverage.findFirst({ where: { subscriptionId }, select: { id: true } }),
        tx.memberEventBalanceLedger.findFirst({ where: { subscriptionId, entryType: "PAYMENT" }, select: { id: true } })
      ]);
      if (coverage || payment) throw new HttpError(409, "Start date cannot change after coverage or payment history exists. Other subscription details can still be edited.");
    }
    await tx.memberEventSubscription.update({ where: { id: subscriptionId }, data: { referenceNo: input.referenceNo, displayName: input.displayName, remark: input.remark, updatedById: userId } });
}

export async function updateSubscription(memberId: string, subscriptionId: string, input: SubscriptionUpdateInput, userId: string) {
  await memberTransaction(tx => updateSubscriptionRecord(tx, memberId, subscriptionId, input, userId));
  return getSponsorship(memberId);
}

export async function allocateSubscription(memberId: string, subscriptionId: string, transactionId: string, userId: string) {
  await memberTransaction(tx => manuallyAllocateTimeBasedPayment(tx, { memberId, subscriptionId, transactionId, userId }));
  return getSponsorship(memberId);
}

export async function addOpeningCoverageRecord(tx: Prisma.TransactionClient, memberId: string, subscriptionId: string, input: OpeningCoverageInput, userId: string) {
    const sub = await tx.memberEventSubscription.findUnique({ where: { id: subscriptionId }, select: { id: true, memberId: true } });
    if (!sub || sub.memberId !== memberId) throw new HttpError(404, "Sponsorship subscription not found");
    const from = new Date(`${input.coverageFrom}T00:00:00.000Z`); const to = new Date(`${input.coverageTo}T00:00:00.000Z`);
    const overlap = await tx.memberEventCoverage.findFirst({ where: { subscriptionId, coverageSource: "OPENING", coverageStatus: "ACTIVE", coverageFrom: { lte: to }, coverageTo: { gte: from } }, select: { id: true } });
    if (overlap) throw new HttpError(409, "Opening coverage overlaps an existing active Opening period for this subscription.");
    await tx.memberEventCoverage.create({ data: { subscriptionId, coverageSource: "OPENING", coverageStatus: "ACTIVE", coverageFrom: from, coverageTo: to, remark: input.remark, createdById: userId } });
    await rebuildTimeBasedSubscription(tx, subscriptionId, userId, "Coverage chain rebuilt after opening coverage was recorded");
}

export async function addOpeningCoverage(memberId: string, subscriptionId: string, input: OpeningCoverageInput, userId: string) {
  await memberTransaction(tx => addOpeningCoverageRecord(tx, memberId, subscriptionId, input, userId));
  return getSponsorship(memberId);
}

export function assertSubscriptionCanDeactivate(amount: string) {
  if (decimalStringToCents(amount) !== 0n)
    throw new HttpError(409, `Resolve the remaining Rp${Number(amount).toLocaleString("id-ID")} carry balance before deactivating this subscription.`);
}

export async function voidOpeningCoverageRecord(tx: Prisma.TransactionClient, memberId: string, subscriptionId: string, coverageId: string, reason: string, userId: string) {
  if (reason.trim().length < 3 || reason.trim().length > 1000) throw new HttpError(400, "A reason of 3–1000 characters is required.");
  const changed = await tx.memberEventCoverage.updateMany({
    where: { id: coverageId, subscriptionId, subscription: { memberId }, coverageSource: "OPENING", coverageStatus: "ACTIVE" },
    data: { coverageStatus: "VOIDED", voidedAt: new Date(), voidedById: userId, voidReason: reason.trim() }
  });
  if (changed.count !== 1) throw new HttpError(409, "This active Opening coverage is no longer available. Reload the subscription.");
  await rebuildTimeBasedSubscription(tx, subscriptionId, userId, "Coverage chain rebuilt after Opening coverage was voided");
}

export async function voidOpeningCoverage(memberId: string, subscriptionId: string, coverageId: string, reason: string, userId: string) {
  await memberTransaction(tx => voidOpeningCoverageRecord(tx, memberId, subscriptionId, coverageId, reason, userId));
  return getSponsorship(memberId);
}

export async function retryAllocationRecord(tx: Prisma.TransactionClient, memberId: string, subscriptionId: string, transactionId: string, userId: string) {
  const payment = await tx.bankTransaction.findUnique({ where: { id: transactionId },
      select: { status: true, originalAmount: true, baseAmount: true, transactionDate: true, reconciliationExcludedAt: true, eventCodeId: true, eventCode: { select: { eventType: true } },
      memberIdentity: { select: { memberId: true, verificationStatus: true } } } });
  if (!payment || payment.status !== "FINALIZED" || !payment.transactionDate || !payment.baseAmount || !payment.baseAmount.gt(0) || !payment.originalAmount.gt(0)
    || payment.reconciliationExcludedAt || payment.eventCode?.eventType !== "TIME_BASED"
    || payment.memberIdentity?.memberId !== memberId || payment.memberIdentity.verificationStatus !== "VERIFIED")
    throw new HttpError(400, "Only an official TIME_BASED payment resolved to this Member can be retried.");
  const compatible = await tx.memberEventSubscription.findMany({ where: { memberId, eventCodeId: payment.eventCodeId!, activeFlag: true }, select: { id: true } });
  if (compatible.length !== 1 || compatible[0].id !== subscriptionId)
    throw new HttpError(409, "Retry requires exactly one compatible active subscription. Reload the pending payments.");
  // The shared engine checks existing PAYMENT proof and makes repeated retries a no-op.
  const result = await synchronizeTimeBasedTransaction(tx, transactionId, userId);
  if (result.state !== "ALLOCATED" || result.subscriptionId !== subscriptionId) throw new HttpError(409, "Payment allocation changed. Reload the pending payments.");
}

export async function retryAllocation(memberId: string, subscriptionId: string, transactionId: string, userId: string) {
  await memberTransaction(tx => retryAllocationRecord(tx, memberId, subscriptionId, transactionId, userId));
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
