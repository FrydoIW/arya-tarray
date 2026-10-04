import type { Prisma } from "@prisma/client";
import { decimalStringToCents } from "../../../lib/money.js";
import { resolveTransferReversibility } from "./member-carry-transfer.foundation.js";

export type CarryTransferReadClient = Pick<Prisma.TransactionClient,
  "member" | "memberEventCarryTransfer" | "memberEventBalanceLedger" | "memberEventCampaignAllocation">;

const subscriptionView = {
  id: true, referenceNo: true, displayName: true,
  eventCode: { select: { id: true, code: true, eventName: true } }
} as const;

const actorView = { id: true, fullName: true } as const;

/** Bounded Member-scoped transfer history with backend-resolved reversibility. */
export async function loadMemberCarryTransfers(
  client: CarryTransferReadClient,
  memberId: string,
  requestedPage: number,
  pageSize: number
) {
  const member = await client.member.findUnique({ where: { id: memberId }, select: { id: true } });
  if (!member) return { member: null, rows: [], total: 0, page: 1 };
  const where: Prisma.MemberEventCarryTransferWhereInput = { memberId };
  const total = await client.memberEventCarryTransfer.count({ where });
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const rows = await client.memberEventCarryTransfer.findMany({
    where,
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true, memberId: true, sourceSubscriptionId: true, sourceCampaignId: true, destinationSubscriptionId: true, destinationCampaignId: true,
      amount: true, effectiveDate: true, reason: true, status: true, reversalOfTransferId: true,
      destinationUnitAmountSnapshot: true, destinationDurationMonthsSnapshot: true,
      createdAt: true, reversedAt: true,
      sourceSubscription: { select: subscriptionView },
      sourceCampaign: { select: { id: true, campaignName: true, eventCode: { select: { id: true, code: true, eventName: true } } } },
      destinationSubscription: { select: subscriptionView },
      destinationCampaign: { select: { id: true, campaignName: true, eventCode: { select: { id: true, code: true, eventName: true } } } },
      createdBy: { select: actorView },
      reversedBy: { select: actorView },
      reversalOf: { select: { id: true, status: true, effectiveDate: true } },
      reversal: { select: { id: true, status: true, effectiveDate: true } }
    }
  });
  const transferIds = rows.map(row => row.id);
  const campaignDestinationIds = rows.flatMap(row => row.destinationCampaignId ? [row.id] : []);
  const [inboundEntries, campaignAllocations] = transferIds.length ? await Promise.all([
    client.memberEventBalanceLedger.findMany({
      where: { carryTransferId: { in: transferIds }, entryType: "TRANSFER_IN", entryStatus: "ACTIVE" },
      select: { carryTransferId: true, subscriptionId: true, postingSequence: true }
    }),
    campaignDestinationIds.length ? client.memberEventCampaignAllocation.findMany({
      where: { carryTransferId: { in: campaignDestinationIds } },
      select: { carryTransferId: true, allocationStatus: true }
    }) : []
  ]) : [[], []];
  const inboundByTransfer = new Map(inboundEntries.map(row => [row.carryTransferId, row]));
  const allocationStatusByTransfer = new Map(campaignAllocations.map(row => [row.carryTransferId, row.allocationStatus]));
  const subscriptionIds = [...new Set(inboundEntries.map(row => row.subscriptionId))];
  const [laterNegativeEntries, balanceGroups] = subscriptionIds.length ? await Promise.all([
    client.memberEventBalanceLedger.findMany({
      where: { subscriptionId: { in: subscriptionIds }, entryStatus: "ACTIVE", amountDelta: { lt: 0 } },
      select: { subscriptionId: true, entryType: true, carryTransferId: true, postingSequence: true }
    }),
    client.memberEventBalanceLedger.groupBy({
      by: ["subscriptionId"],
      where: { subscriptionId: { in: subscriptionIds }, entryStatus: "ACTIVE" },
      _sum: { amountDelta: true }
    })
  ]) : [[], []];
  const downstreamIds = [...new Set(laterNegativeEntries.flatMap(row => row.carryTransferId ? [row.carryTransferId] : []))];
  const downstream = downstreamIds.length ? await client.memberEventCarryTransfer.findMany({
    where: { id: { in: downstreamIds } }, select: { id: true, status: true }
  }) : [];
  const downstreamStatusById = new Map(downstream.map(row => [row.id, row.status]));
  const carryBySubscription = new Map(balanceGroups.map(row =>
    [row.subscriptionId, decimalStringToCents(row._sum.amountDelta?.toString() ?? "0")] as const));
  return { member, rows: rows.map(row => {
    const inbound = inboundByTransfer.get(row.id) ?? null;
    const decision = resolveTransferReversibility({
      status: row.status,
      hasReversal: Boolean(row.reversal),
      isReversal: Boolean(row.reversalOfTransferId),
      destinationSubscriptionId: row.destinationSubscriptionId,
      destinationCampaignId: row.destinationCampaignId,
      amountCents: decimalStringToCents(row.amount.toString()),
      inbound,
      laterNegativeEntries: inbound ? laterNegativeEntries.filter(entry => entry.subscriptionId === inbound.subscriptionId) : [],
      downstreamStatusById,
      destinationCarryCents: inbound ? carryBySubscription.get(inbound.subscriptionId) ?? 0n : null,
      destinationAllocationStatus: allocationStatusByTransfer.get(row.id) ?? null
    });
    return { ...row, isReversible: decision.reversible, reversalBlockedReason: decision.reversalBlockedReason };
  }), total, page };
}
