import type { Prisma } from "@prisma/client";

export type CarryTransferReadClient = Pick<Prisma.TransactionClient, "member" | "memberEventCarryTransfer" | "memberEventBalanceLedger">;

const subscriptionView = {
  id: true, referenceNo: true, displayName: true,
  eventCode: { select: { id: true, code: true, eventName: true } }
} as const;

const actorView = { id: true, fullName: true } as const;

/** Bounded Member-scoped transfer history. Caller supplies the transaction client. */
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
  const inboundTransfers = rows.filter(row => row.destinationSubscriptionId);
  const transferIds = inboundTransfers.map(row => row.id);
  const inboundEntries = transferIds.length ? await client.memberEventBalanceLedger.findMany({
    where: { carryTransferId: { in: transferIds }, entryType: "TRANSFER_IN", entryStatus: "ACTIVE" },
    select: { carryTransferId: true, subscriptionId: true, postingSequence: true }
  }) : [];
  const subscriptionIds = [...new Set(inboundEntries.map(row => row.subscriptionId))];
  const latestNegative = subscriptionIds.length ? await client.memberEventBalanceLedger.groupBy({
    by: ["subscriptionId"],
    where: { subscriptionId: { in: subscriptionIds }, entryStatus: "ACTIVE", amountDelta: { lt: 0 } },
    _max: { postingSequence: true }
  }) : [];
  const inboundByTransfer = new Map(inboundEntries.map(row => [row.carryTransferId, row]));
  const latestNegativeBySubscription = new Map(latestNegative.map(row => [row.subscriptionId, row._max.postingSequence ?? 0]));
  return { member, rows: rows.map(row => {
    const inbound = inboundByTransfer.get(row.id);
    const laterNegative = inbound ? (latestNegativeBySubscription.get(inbound.subscriptionId) ?? 0) > inbound.postingSequence : false;
    return { ...row, isReversible: row.status === "ACTIVE" && !row.reversal && !row.reversalOf && !laterNegative };
  }), total, page };
}
