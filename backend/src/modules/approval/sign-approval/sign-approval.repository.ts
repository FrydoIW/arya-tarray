import { businessDayUtcRange } from "../../../lib/business-time.js";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import { Prisma } from "@prisma/client";
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
  const approvalScope: Prisma.ReconciliationApprovalWhereInput = {
    OR: [
      { approvers: { some: { userId } } },
      { correctionProposals: { some: { approvers: { some: { userId } } } } }
    ]
  };

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
      },
      correctionProposals: {
        include: {
          proposedBy: { select: { id: true, fullName: true } },
          decidedBy: { select: { id: true, fullName: true } },
          approvers: {
            select: snapshotApproverSelect,
            orderBy: [{ createdAt: "asc" }, { id: "asc" }]
          },
          items: {
            include: {
              bankTransaction: {
                select: {
                  id: true,
                  rowNo: true,
                  transactionDate: true,
                  referenceNo: true,
                  description: true,
                  originalAmount: true
                }
              },
              beforeEventCode: { select: { id: true, code: true, eventName: true } },
              proposedEventCode: { select: { id: true, code: true, eventName: true } }
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }]
          }
        },
        orderBy: [{ proposedAt: "desc" }, { createdAt: "desc" }],
        take: 1
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

  const correctionProposal = approval.correctionProposals[0] ?? null;
  const effectiveApprovers = correctionProposal?.approvers ?? approval.approvers;
  requireApprovalSnapshotMembership(effectiveApprovers, userId);

  const [checkedTransactions, needsReviewTransactions, approvedManualAdjustments, approvedExcludedBankTransactions] = await Promise.all([
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
    }),
    prisma.bankTransaction.aggregate({
      where: {
        statementUploadId: approval.statementUploadId,
        status: "FINALIZED",
        sourceType: "MANUAL",
        reconciliationExcludedAt: null
      },
      _sum: { originalAmount: true }
    }),
    prisma.bankTransaction.aggregate({
      where: {
        statementUploadId: approval.statementUploadId,
        status: "FINALIZED",
        sourceType: "BANK",
        reconciliationExcludedAt: { not: null }
      },
      _sum: { originalAmount: true }
    })
  ]);

  return {
    eligible: true as const,
    approval,
    correctionProposal,
    approvers: effectiveApprovers,
    checkedTransactions,
    needsReviewTransactions,
    approvedManualAdjustmentAmount: approvedManualAdjustments._sum.originalAmount,
    approvedExcludedBankAmount: approvedExcludedBankTransactions._sum.originalAmount
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
        approvers: { select: { userId: true } },
        correctionProposals: {
          where: { status: "PENDING" },
          select: {
            id: true,
            status: true,
            proposedById: true,
            approvers: { select: { userId: true } },
            items: {
              select: {
                id: true,
                action: true,
                bankTransactionId: true,
                beforeEventCodeId: true,
                proposedEventCodeId: true,
                beforeRemark: true,
                proposedRemark: true,
                correctionReason: true,
                manualTransactionDate: true,
                manualTransactionType: true,
                manualDescription: true,
                manualOriginalAmount: true,
                bankTransaction: {
                  select: {
                    id: true,
                    eventCodeId: true,
                    remark: true,
                    reconciliationExcludedAt: true
                  }
                }
              },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }]
            }
          },
          orderBy: [{ proposedAt: "desc" }, { createdAt: "desc" }],
          take: 1
        }
      }
    });

    if (!current) throw new HttpError(404, "Approval request not found");
    const correctionProposal = current.correctionProposals[0] ?? null;
    requireApprovalSnapshotMembership(correctionProposal?.approvers ?? current.approvers, input.userId);
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

    if (correctionProposal) {
      if (input.decision === "APPROVED") {
        for (const item of correctionProposal.items) {
          if (item.action === "MODIFIED") {
            if (!item.bankTransaction || item.bankTransaction.eventCodeId !== item.beforeEventCodeId
              || (item.bankTransaction.remark?.trim() || null) !== item.beforeRemark) {
              throw new HttpError(409, "Official transaction data changed after this correction was proposed. No correction was applied.");
            }
            await tx.bankTransaction.update({
              where: { id: item.bankTransaction.id },
              data: { eventCodeId: item.proposedEventCodeId, remark: item.proposedRemark }
            });
            if (item.beforeEventCodeId !== item.proposedEventCodeId) {
              await tx.bankTransactionHistory.create({ data: {
                bankTransactionId: item.bankTransaction.id,
                fieldName: "event_code_id",
                oldValue: item.beforeEventCodeId,
                newValue: item.proposedEventCodeId,
                remark: "Approved Edit Income correction",
                changedAt: now,
                changedById: input.userId
              } });
            }
            if (item.beforeRemark !== item.proposedRemark) {
              await tx.bankTransactionHistory.create({ data: {
                bankTransactionId: item.bankTransaction.id,
                fieldName: "remark",
                oldValue: item.beforeRemark,
                newValue: item.proposedRemark,
                remark: "Approved Edit Income correction",
                changedAt: now,
                changedById: input.userId
              } });
            }
          } else if (item.action === "EXCLUDED") {
            if (!item.bankTransaction || item.bankTransaction.reconciliationExcludedAt) {
              throw new HttpError(409, "An excluded transaction changed after this correction was proposed. No correction was applied.");
            }
            await tx.bankTransaction.update({
              where: { id: item.bankTransaction.id },
              data: {
                reconciliationExcludedAt: now,
                reconciliationExcludedById: input.userId,
                reconciliationExclusionReason: item.correctionReason
              }
            });
            await tx.bankTransactionHistory.create({ data: {
              bankTransactionId: item.bankTransaction.id,
              fieldName: "reconciliation_excluded_at",
              oldValue: null,
              newValue: now.toISOString(),
              remark: item.correctionReason,
              changedAt: now,
              changedById: input.userId
            } });
          } else if (item.action === "ADDED") {
            const transaction = await tx.bankTransaction.create({
              data: {
                statementUploadId: current.statementUploadId,
                rowNo: null,
                transactionDate: item.manualTransactionDate,
                transactionType: item.manualTransactionType,
                description: item.manualDescription,
                originalAmount: item.manualOriginalAmount!,
                baseAmount: item.manualOriginalAmount && item.manualOriginalAmount.greaterThan(0)
                  ? item.manualOriginalAmount
                  : null,
                eventCodeId: item.proposedEventCodeId,
                remark: item.proposedRemark,
                status: "FINALIZED",
                sourceType: "MANUAL",
                correctionReason: item.correctionReason,
                manualAddedAt: now,
                manualAddedById: correctionProposal.proposedById
              },
              select: { id: true }
            });
            await tx.reconciliationCorrectionItem.update({
              where: { id: item.id },
              data: { bankTransactionId: transaction.id }
            });
            await tx.bankTransactionHistory.create({ data: {
              bankTransactionId: transaction.id,
              fieldName: "source_type",
              oldValue: null,
              newValue: "MANUAL",
              remark: item.correctionReason,
              changedAt: now,
              changedById: input.userId
            } });
          }
        }
      }

      const proposalUpdate = await tx.reconciliationCorrectionProposal.updateMany({
        where: { id: correctionProposal.id, status: "PENDING" },
        data: { status: input.decision, decidedAt: now, decidedById: input.userId }
      });
      if (proposalUpdate.count !== 1) throw new HttpError(409, ALREADY_DECIDED_MESSAGE);

      await tx.bankStatementUpload.update({
        where: { id: current.statementUploadId },
        data: input.decision === "APPROVED"
          ? { status: "FINALIZED", finalizedAt: now, finalizedById: input.userId }
          : { status: "FINALIZED" }
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
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
