import { HttpError } from "../../../lib/http.js";

export const LEGACY_APPROVAL_SNAPSHOT_MESSAGE =
  "This approval request has no approver snapshot. Resolve this legacy pending approval operationally before continuing.";

export function buildApprovalApproverSnapshot(
  approvalId: string,
  approvers: ReadonlyArray<{ approverUserId: string }>
) {
  return [...new Set(approvers.map((approver) => approver.approverUserId))].map((userId) => ({
    approvalId,
    userId
  }));
}

export function requireApprovalSnapshotMembership(
  approvers: ReadonlyArray<{ userId: string }>,
  userId: string
) {
  if (approvers.length === 0) throw new HttpError(409, LEGACY_APPROVAL_SNAPSHOT_MESSAGE);
  if (!approvers.some((approver) => approver.userId === userId)) {
    throw new HttpError(403, "You are not an approver assigned to this approval request.");
  }
}
