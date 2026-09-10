import type { Prisma } from "@prisma/client";

export type MemberIdentityHistoryAction = "REGISTER" | "LINK" | "ATTACH" | "IGNORE" | "MOVE" | "DETACH";

type IdentityOwnershipState = {
  memberId: string | null;
  verificationStatus: string;
};

export function recordMemberIdentityHistory(
  tx: Prisma.TransactionClient,
  input: {
    memberIdentityId: string;
    action: MemberIdentityHistoryAction;
    before: IdentityOwnershipState;
    after: IdentityOwnershipState;
    reason?: string | null;
    actionById: string;
    actionAt?: Date;
  }
) {
  return tx.memberIdentityHistory.create({
    data: {
      memberIdentityId: input.memberIdentityId,
      action: input.action,
      fromMemberId: input.before.memberId,
      toMemberId: input.after.memberId,
      statusBefore: input.before.verificationStatus,
      statusAfter: input.after.verificationStatus,
      reason: input.reason?.trim() || null,
      actionById: input.actionById,
      actionAt: input.actionAt ?? new Date()
    },
    select: { id: true }
  });
}
