import { businessDayUtcRange } from "../../../lib/business-time.js";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import { requireApprovalSnapshotMembership } from "./approval-snapshot.domain.js";

const DECIDED_STATUSES = ["APPROVED", "REJECTED"] as const;
const ALREADY_DECIDED_MESSAGE = "This approval request has already been decided. Reload the approval queue.";

const snapshotApproverSelect = {
  userId: true,
  user: {
    select: {
      id: true,
      fullName: true,
      email: true,
      status: true
    }
  }
} as const;

const queueItemInclude = {
  statementUpload: {
    select: {
      id: true,
      periodFrom: true,
      periodTo: true,
      totalTransaction: true,
      totalCredit: true,
      totalDebit: true,
      status: true,
      bankAccount: {
        select: {
          id: true,
          bankCode: true,
          bankName: true,
          accountNo: true,
          accountName: true,
          currencyCode: true
        }
      },
      uploadedBy: {
        select: {
          id: true,
          fullName: true
        }
      }
    }
  },
  decidedBy: {
    select: {
      id: true,
      fullName: true
    }
  }
} as const;

export async function loadSignApprovalWorkspace(userId: string) {
  const { start: today, end: tomorrow } = businessDayUtcRange();
  const approvalScope = { approvers: { some: { userId } } } as const;

  const [approvals, pendingApproval, approvedToday, rejectedToday, totalDecided, legacyPendingApproval] = await Promise.all([
    prisma.reconciliationApproval.findMany({
      where: approvalScope,
      include: queueItemInclude,
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }]
    }),
    prisma.reconciliationApproval.count({ where: { ...approvalScope, status: "PENDING" } }),
    prisma.reconciliationApprovalHistory.count({
      where: {
        action: "APPROVED",
        actionAt: { gte: today, lt: tomorrow },
        approval: { is: approvalScope }
      }
    }),
    prisma.reconciliationApprovalHistory.count({
      where: {
        action: "REJECTED",
        actionAt: { gte: today, lt: tomorrow },
        approval: { is: approvalScope }
      }
    }),
    prisma.reconciliationApprovalHistory.count({
      where: { action: { in: [...DECIDED_STATUSES] }, approval: { is: approvalScope } }
    }),
    prisma.reconciliationApproval.count({
      where: { status: "PENDING", approvers: { none: {} } }
    })
  ]);

  return {
    eligible: true as const,
    summary: {
      pendingApproval,
      approvedToday,
      rejectedToday,
      totalDecided,
      legacyPendingApproval
    },
    approvals
  };
}

export async function loadSignApprovalDetail(approvalId: string, userId: string) {
  const approval = await prisma.reconciliationApproval.findUnique({
    where: { id: approvalId },
    include: {
      statementUpload: {
        include: {
          bankAccount: {
            select: {
              id: true,
              bankCode: true,
              bankName: true,
              accountNo: true,
              accountName: true,
              currencyCode: true
            }
          },
          uploadedBy: {
            select: {
              id: true,
              fullName: true
            }
          },
          transactions: {
            include: {
              suggestedEventCode: {
                select: {
                  id: true,
                  code: true,
                  eventName: true
                }
              },
              eventCode: {
                select: {
                  id: true,
                  code: true,
                  eventName: true
                }
              }
            },
            orderBy: [{ rowNo: "asc" }, { createdAt: "asc" }],
            take: 10
          },
          _count: {
            select: { transactions: true }
          }
        }
      },
      submittedBy: {
        select: {
          id: true,
          fullName: true
        }
      },
      decidedBy: {
        select: {
          id: true,
          fullName: true
        }
      },
      history: {
        include: {
          actionBy: {
            select: {
              id: true,
              fullName: true
            }
          }
        },
        orderBy: [{ actionAt: "asc" }, { id: "asc" }]
      },
      approvers: {
        select: snapshotApproverSelect,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }
    }
  });

  if (!approval) {
    return {
      eligible: true as const,
      approval: null,
      checkedTransactions: 0,
      needsReviewTransactions: 0
    };
  }

  requireApprovalSnapshotMembership(approval.approvers, userId);

  const [checkedTransactions, needsReviewTransactions] = await Promise.all([
    prisma.bankTransaction.count({
      where: {
        statementUploadId: approval.statementUploadId,
        status: "CHECK"
      }
    }),
    prisma.bankTransaction.count({
      where: {
        statementUploadId: approval.statementUploadId,
        status: { not: "CHECK" }
      }
    })
  ]);

  return {
    eligible: true as const,
    approval,
    approvers: approval.approvers,
    checkedTransactions,
    needsReviewTransactions
  };
}

export type SignApprovalDecision = "APPROVED" | "REJECTED";

export async function decideSignApprovalAtomic(input: {
  approvalId: string;
  userId: string;
  decision: SignApprovalDecision;
  remark?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.reconciliationApproval.findUnique({
      where: { id: input.approvalId },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        statementUploadId: true,
        statementUpload: {
          select: { id: true, status: true }
        },
        approvers: { select: { userId: true } }
      }
    });

    if (!current) throw new HttpError(404, "Approval request not found");
    requireApprovalSnapshotMembership(current.approvers, input.userId);
    if (current.status !== "PENDING") throw new HttpError(409, ALREADY_DECIDED_MESSAGE);
    if (current.statementUpload.status !== "CHECK") {
      throw new HttpError(409, "This statement is no longer Pending Approval. Reload the approval queue.");
    }

    const now = new Date();
    const updateResult = await tx.reconciliationApproval.updateMany({
      where: {
        id: input.approvalId,
        status: "PENDING"
      },
      data: {
        status: input.decision,
        decidedAt: now,
        decidedById: input.userId,
        remark: input.remark ?? null
      }
    });

    if (updateResult.count !== 1) throw new HttpError(409, ALREADY_DECIDED_MESSAGE);

    const priorApprovedCount = await tx.reconciliationApprovalHistory.count({
      where: {
        approvalId: current.id,
        action: "APPROVED",
        actionAt: { lt: current.submittedAt }
      }
    });
    const correctionSubmission = priorApprovedCount > 0;

    if (input.decision === "REJECTED" && correctionSubmission) {
      const correctionHistory = await tx.bankTransactionHistory.findMany({
        where: {
          changedAt: current.submittedAt,
          fieldName: { in: ["event_code_id", "remark"] },
          remark: "Edit Income correction",
          transaction: { statementUploadId: current.statementUploadId }
        },
        select: {
          bankTransactionId: true,
          fieldName: true,
          oldValue: true,
          newValue: true
        },
        orderBy: { id: "desc" }
      });

      const rollbackByTransaction = new Map<string, { eventCodeId?: string | null; remark?: string | null }>();
      for (const history of correctionHistory) {
        const rollback = rollbackByTransaction.get(history.bankTransactionId) ?? {};
        if (history.fieldName === "event_code_id") rollback.eventCodeId = history.oldValue;
        if (history.fieldName === "remark") rollback.remark = history.oldValue;
        rollbackByTransaction.set(history.bankTransactionId, rollback);

        await tx.bankTransactionHistory.create({
          data: {
            bankTransactionId: history.bankTransactionId,
            fieldName: history.fieldName,
            oldValue: history.newValue,
            newValue: history.oldValue,
            remark: "Edit Income correction rejected; previous approved value restored.",
            changedAt: now,
            changedById: input.userId
          }
        });
      }

      for (const [transactionId, rollback] of rollbackByTransaction) {
        await tx.bankTransaction.update({
          where: { id: transactionId },
          data: {
            ...(Object.prototype.hasOwnProperty.call(rollback, "eventCodeId")
              ? { eventCodeId: rollback.eventCodeId ?? null }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(rollback, "remark")
              ? { remark: rollback.remark ?? null }
              : {}),
            status: "FINALIZED"
          }
        });
      }

      await tx.bankStatementUpload.update({
        where: { id: current.statementUploadId },
        data: { status: "FINALIZED" }
      });
      await tx.bankTransaction.updateMany({
        where: { statementUploadId: current.statementUploadId },
        data: { status: "FINALIZED" }
      });
    } else {
      const statementStatus = input.decision === "APPROVED" ? "FINALIZED" : "RAW";
      await tx.bankStatementUpload.update({
        where: { id: current.statementUploadId },
        data: input.decision === "APPROVED"
          ? {
              status: statementStatus,
              finalizedAt: now,
              finalizedById: input.userId
            }
          : {
              status: statementStatus,
              finalizedAt: null,
              finalizedById: null
            }
      });
      await tx.bankTransaction.updateMany({
        where: { statementUploadId: current.statementUploadId },
        data: { status: statementStatus }
      });
    }

    await tx.reconciliationApprovalHistory.create({
      data: {
        approvalId: current.id,
        action: input.decision,
        remark: input.remark ?? null,
        actionAt: now,
        actionById: input.userId
      }
    });

    return tx.reconciliationApproval.findUniqueOrThrow({
      where: { id: current.id },
      select: {
        id: true,
        status: true,
        decidedAt: true,
        remark: true,
        statementUpload: {
          select: { id: true, status: true }
        },
        decidedBy: {
          select: {
            id: true,
            fullName: true
          }
        }
      }
    });
  });
}
