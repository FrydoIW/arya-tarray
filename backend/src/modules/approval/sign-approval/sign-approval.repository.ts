import { businessDayUtcRange } from "../../../lib/business-time.js";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import { Prisma } from "@prisma/client";
import { requireApprovalSnapshotMembership } from "./approval-snapshot.domain.js";
import { synchronizeTimeBasedTransaction } from "../../member/time-based/member-time-based.service.js";

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
  },
  approvers: {
    select: { userId: true }
  },
  correctionProposals: {
    select: {
      id: true,
      status: true,
      approvers: { select: { userId: true } }
    },
    orderBy: [{ proposedAt: "desc" }, { createdAt: "desc" }],
    take: 1
  }
} satisfies Prisma.ReconciliationApprovalInclude;

function effectiveQueueApprovers(item: {
  approvers: Array<{ userId: string }>;
  correctionProposals: Array<{ approvers: Array<{ userId: string }> }>;
}) {
  return item.correctionProposals[0]?.approvers ?? item.approvers;
}

export async function loadSignApprovalWorkspace(userId: string) {
  const { start: today, end: tomorrow } = businessDayUtcRange();

  // A reconciliation approval row is reused for re-approval cycles. Use the OR
  // only as a DB-side candidate reduction, then evaluate the latest correction
  // snapshot in memory. This prevents an old snapshot from granting visibility
  // to the current pending cycle without scanning the entire approval table.
  const candidateScope: Prisma.ReconciliationApprovalWhereInput = {
    OR: [
      { approvers: { some: { userId } } },
      { correctionProposals: { some: { approvers: { some: { userId } } } } }
    ]
  };

  const [candidateApprovals, pendingSnapshotRows] = await Promise.all([
    prisma.reconciliationApproval.findMany({
      where: candidateScope,
      include: queueItemInclude,
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }]
    }),
    prisma.reconciliationApproval.findMany({
      where: { status: "PENDING" },
      select: {
        approvers: { select: { userId: true } },
        correctionProposals: {
          select: { approvers: { select: { userId: true } } },
          orderBy: [{ proposedAt: "desc" }, { createdAt: "desc" }],
          take: 1
        }
      }
    })
  ]);

  const approvals = candidateApprovals.filter((item) =>
    effectiveQueueApprovers(item).some((assignment) => assignment.userId === userId)
  );
  const approvalIds = approvals.map((item) => item.id);
  const pendingApproval = approvals.filter((item) => item.status === "PENDING").length;
  const legacyPendingApproval = pendingSnapshotRows.filter((item) =>
    effectiveQueueApprovers(item).length === 0
  ).length;

  const historyScope = approvalIds.length > 0 ? { approvalId: { in: approvalIds } } : { approvalId: { in: [] as string[] } };
  const [approvedToday, rejectedToday, totalDecided] = await Promise.all([
    prisma.reconciliationApprovalHistory.count({
      where: {
        ...historyScope,
        action: "APPROVED",
        actionAt: { gte: today, lt: tomorrow }
      }
    }),
    prisma.reconciliationApprovalHistory.count({
      where: {
        ...historyScope,
        action: "REJECTED",
        actionAt: { gte: today, lt: tomorrow }
      }
    }),
    prisma.reconciliationApprovalHistory.count({
      where: { ...historyScope, action: { in: [...DECIDED_STATUSES] } }
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
                  eventName: true,
                  eventType: true,
                  timeRule: { select: { unitAmount: true, durationMonths: true, activeFlag: true } }
                }
              },
              eventCampaign: { select: { id: true, campaignName: true } },
              memberEventCoverages: { where: { coverageStatus: "ACTIVE", coverageSource: "TRANSACTION" }, select: { unitAmountSnapshot: true, durationMonthsSnapshot: true, grantedUnits: true }, take: 1 }
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
                  originalAmount: true,
                  sourceType: true
                }
              },
              beforeEventCode: { select: { id: true, code: true, eventName: true } },
              proposedEventCode: { select: { id: true, code: true, eventName: true } },
              beforeEventCampaign: { select: { id: true, campaignName: true } },
              proposedEventCampaign: { select: { id: true, campaignName: true } }
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
    prisma.bankTransaction.findMany({
      where: {
        statementUploadId: approval.statementUploadId,
        status: "FINALIZED",
        sourceType: "MANUAL",
        reconciliationExcludedAt: null
      },
      select: { originalAmount: true }
    }),
    prisma.bankTransaction.findMany({
      where: {
        statementUploadId: approval.statementUploadId,
        status: "FINALIZED",
        sourceType: "BANK",
        reconciliationExcludedAt: { not: null }
      },
      select: { originalAmount: true }
    })
  ]);

  return {
    eligible: true as const,
    approval,
    correctionProposal,
    approvers: effectiveApprovers,
    checkedTransactions,
    needsReviewTransactions,
    approvedManualAdjustments,
    approvedExcludedBankTransactions
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
                beforeEventCampaignId: true,
                proposedEventCodeId: true,
                proposedEventCampaignId: true,
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
                    eventCampaignId: true,
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
              || item.bankTransaction.eventCampaignId !== item.beforeEventCampaignId
              || (item.bankTransaction.remark?.trim() || null) !== item.beforeRemark) {
              throw new HttpError(409, "Official transaction data changed after this correction was proposed. No correction was applied.");
            }
            await tx.bankTransaction.update({
              where: { id: item.bankTransaction.id },
              data: { eventCodeId: item.proposedEventCodeId, eventCampaignId: item.proposedEventCampaignId, remark: item.proposedRemark }
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
            if (item.beforeEventCampaignId !== item.proposedEventCampaignId) {
              await tx.bankTransactionHistory.create({ data: {
                bankTransactionId: item.bankTransaction.id,
                fieldName: "event_campaign_id",
                oldValue: item.beforeEventCampaignId,
                newValue: item.proposedEventCampaignId,
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
                eventCampaignId: item.proposedEventCampaignId,
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

    if (input.decision === "APPROVED") {
      const changedTimeBasedTransactionIds = new Set(
        correctionProposal?.items
          .filter((item) => item.bankTransactionId && (item.action === "EXCLUDED" || (item.action === "MODIFIED" && item.beforeEventCodeId !== item.proposedEventCodeId)))
          .map((item) => item.bankTransactionId!) ?? []
      );
      const timeBasedTransactions = await tx.bankTransaction.findMany({
        where: {
          statementUploadId: current.statementUploadId,
          status: "FINALIZED",
          OR: [
            { eventCode: { is: { eventType: "TIME_BASED" } } },
            { memberEventCoverages: { some: { coverageStatus: "ACTIVE" } } }
          ]
        },
        select: { id: true }
      });
      for (const transaction of timeBasedTransactions) {
        await synchronizeTimeBasedTransaction(tx, transaction.id, input.userId, { recalculate: changedTimeBasedTransactionIds.has(transaction.id) });
      }
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
