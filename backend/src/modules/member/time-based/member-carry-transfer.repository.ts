import type { Prisma } from "@prisma/client";

export type CarryTransferReadClient = Pick<Prisma.TransactionClient, "member" | "memberEventCarryTransfer">;

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
      id: true, memberId: true, sourceSubscriptionId: true, destinationSubscriptionId: true, destinationCampaignId: true,
      amount: true, effectiveDate: true, reason: true, status: true, reversalOfTransferId: true,
      destinationUnitAmountSnapshot: true, destinationDurationMonthsSnapshot: true,
      createdAt: true, reversedAt: true,
      sourceSubscription: { select: subscriptionView },
      destinationSubscription: { select: subscriptionView },
      destinationCampaign: { select: { id: true, campaignName: true, eventCode: { select: { id: true, code: true, eventName: true } } } },
      createdBy: { select: actorView },
      reversedBy: { select: actorView },
      reversalOf: { select: { id: true, status: true, effectiveDate: true } },
      reversal: { select: { id: true, status: true, effectiveDate: true } }
    }
  });
  return { member, rows, total, page };
}
