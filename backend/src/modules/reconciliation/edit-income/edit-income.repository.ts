import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import { storedTransactionRequiresClassification } from "../reconciliation-classification.js";
import { assertCampaignClassification } from "../campaign-classification.js";
import { resolveTimeBasedUnits } from "../time-based-classification.js";
import { loadActiveStatementApprovalConfigWithEligibleApprovers } from "../reconciliation-approval.js";

const bankAccountSelect = {
  id: true,
  bankCode: true,
  bankName: true,
  accountNo: true,
  accountName: true,
  currencyCode: true
} as const;

const eventCodeSelect = {
  id: true,
  code: true,
  eventName: true,
  eventType: true,
  activeFlag: true,
  timeRule: { select: { unitAmount: true, durationMonths: true, activeFlag: true } }
} as const;

const statementSummarySelect = {
  id: true,
  fileName: true,
  periodFrom: true,
  periodTo: true,
  totalTransaction: true,
  totalCredit: true,
  totalDebit: true,
  status: true,
  uploadedAt: true,
  finalizedAt: true,
  bankAccount: { select: bankAccountSelect },
  uploadedBy: { select: { id: true, fullName: true } },
  approval: {
    select: {
      id: true,
      status: true,
      submittedAt: true,
      decidedAt: true,
      history: {
        where: { action: "APPROVED" },
        select: { id: true },
        take: 1
      }
    }
  }
} as const;

export type EditIncomeWorkspaceRange = {
  mode: "MONTH" | "DAY";
  start: Date;
  end: Date;
};

export async function loadEditIncomeWorkspaceRecords(range: EditIncomeWorkspaceRange) {
  const statements = await prisma.bankStatementUpload.findMany({
    where: {
      status: { in: ["FINALIZED", "CHECK"] },
      ...(range.mode === "DAY"
        ? { periodFrom: { lte: range.start }, periodTo: { gte: range.start } }
        : { periodFrom: { lt: range.end }, periodTo: { gte: range.start } }),
      approval: {
        is: {
          history: { some: { action: "APPROVED" } }
        }
      }
    },
    select: statementSummarySelect,
    orderBy: [{ periodTo: "desc" }, { finalizedAt: "desc" }, { createdAt: "desc" }]
  });

  return { statements };
}

export async function loadEditIncomeDetailRecord(statementId: string) {
  const [statement, eventCodes, campaigns] = await Promise.all([
    prisma.bankStatementUpload.findUnique({
      where: { id: statementId },
      include: {
        bankAccount: { select: bankAccountSelect },
        uploadedBy: { select: { id: true, fullName: true } },
        finalizedBy: { select: { id: true, fullName: true } },
        transactions: {
          include: {
            suggestedEventCode: { select: eventCodeSelect },
            eventCode: { select: eventCodeSelect },
            eventCampaign: { select: { id: true, campaignName: true } }
          },
          orderBy: [{ rowNo: "asc" }, { createdAt: "asc" }]
        },
        approval: {
          include: {
            history: {
              orderBy: [{ actionAt: "asc" }, { id: "asc" }],
              include: {
                actionBy: { select: { id: true, fullName: true } }
              }
            }
          }
        }
      }
    }),
    prisma.eventCode.findMany({
      where: {
        OR: [
          { activeFlag: true },
          { transactions: { some: { statementUploadId: statementId } } },
          { suggestedTransactions: { some: { statementUploadId: statementId } } }
        ]
      },
      select: eventCodeSelect,
      orderBy: [{ activeFlag: "desc" }, { code: "asc" }, { eventName: "asc" }]
    }),
    prisma.eventCampaign.findMany({
      where: { OR: [
        { activeFlag: true, eventCode: { activeFlag: true } },
        { transactions: { some: { statementUploadId: statementId } } }
      ] },
      select: { id: true, eventCodeId: true, campaignName: true, startDate: true, endDate: true, activeFlag: true },
      orderBy: [{ activeFlag: "desc" }, { startDate: "desc" }, { campaignName: "asc" }]
    })
  ]);

  return { statement, eventCodes, campaigns };
}

export type EditIncomeCorrectionInput = {
  statementId: string;
  userId: string;
  corrections: Array<
    | { action: "MODIFIED"; transactionId: string; eventCodeId: string | null; eventCampaignId?: string | null; remark: string | null }
    | { action: "EXCLUDED"; transactionId: string; reason: string }
    | {
        action: "ADDED";
        clientId: string;
        direction: "INCOMING" | "OUTGOING";
        transactionDate: string;
        description: string;
        amount: string;
        eventCodeId: string | null;
        eventCampaignId?: string | null;
        remark: string | null;
        reason: string;
      }
  >;
};

export async function executeEditIncomeCorrectionAtomic(input: EditIncomeCorrectionInput) {
  return prisma.$transaction(async (tx) => {
    const existingCorrections = input.corrections.filter((item) => item.action !== "ADDED");
    const statement = await tx.bankStatementUpload.findUnique({
      where: { id: input.statementId },
      select: {
        id: true,
        status: true,
        periodFrom: true,
        periodTo: true,
        approval: {
          select: {
            id: true,
            status: true,
            history: {
              where: { action: "APPROVED" },
              select: { id: true },
              take: 1
            },
            correctionProposals: {
              where: { status: "PENDING" },
              select: { id: true },
              take: 1
            }
          }
        },
        transactions: {
          where: { id: { in: existingCorrections.map((change) => change.transactionId) } },
          select: {
            id: true,
            transactionType: true,
            originalAmount: true,
            baseAmount: true,
            eventCodeId: true,
            eventCampaignId: true,
            transactionDate: true,
            remark: true,
            reconciliationExcludedAt: true
          }
        }
      }
    });

    if (!statement) throw new HttpError(404, "Statement not found");
    if (statement.status !== "FINALIZED") {
      throw new HttpError(409, "Only Complete statements can be corrected. Reload the Edit Income workspace.");
    }
    if (!statement.approval || statement.approval.history.length === 0) {
      throw new HttpError(409, "This statement has no previous approved reconciliation result.");
    }
    if (!["APPROVED", "REJECTED"].includes(statement.approval.status)) {
      throw new HttpError(409, "This statement already has an active approval request. Reload the Edit Income workspace.");
    }
    if (statement.approval.correctionProposals.length > 0) {
      throw new HttpError(409, "This statement already has a pending correction proposal. Reload the Edit Income workspace.");
    }
    if (statement.transactions.length !== existingCorrections.length) {
      throw new HttpError(400, "One or more correction transactions do not belong to this statement.");
    }

    const currentById = new Map(statement.transactions.map((transaction) => [transaction.id, transaction]));
    const targetEventCodeIds = [...new Set(input.corrections.flatMap((change) => {
      if (change.action === "ADDED") return change.eventCodeId ? [change.eventCodeId] : [];
      if (change.action !== "MODIFIED" || !change.eventCodeId) return [];
      const current = currentById.get(change.transactionId);
      return current && current.eventCodeId !== change.eventCodeId ? [change.eventCodeId] : [];
    }))];
    const activeEventCodes = targetEventCodeIds.length
      ? await tx.eventCode.findMany({
          where: { id: { in: targetEventCodeIds }, activeFlag: true },
          select: { id: true }
        })
      : [];
    const activeEventCodeIds = new Set(activeEventCodes.map((item) => item.id));
    if (activeEventCodeIds.size !== targetEventCodeIds.length) {
      throw new HttpError(400, "One or more newly selected Final Events are inactive or no longer available.");
    }

    const selectedEventIds = [...new Set(input.corrections.flatMap((change) =>
      change.action !== "EXCLUDED" && change.eventCodeId ? [change.eventCodeId] : []
    ))];
    const selectedCampaignIds = [...new Set(input.corrections.flatMap((change) =>
      change.action !== "EXCLUDED" && change.eventCampaignId ? [change.eventCampaignId] : []
    ))];
    const [selectedEvents, selectedCampaigns] = await Promise.all([
      tx.eventCode.findMany({ where: { id: { in: selectedEventIds } }, select: { id: true, eventType: true, timeRule: { select: { unitAmount: true, durationMonths: true, activeFlag: true } } } }),
      tx.eventCampaign.findMany({ where: { id: { in: selectedCampaignIds } }, select: { id: true, eventCodeId: true, activeFlag: true, startDate: true, endDate: true } })
    ]);
    const selectedEventById = new Map(selectedEvents.map((event) => [event.id, event]));
    const selectedCampaignById = new Map(selectedCampaigns.map((campaign) => [campaign.id, campaign]));

    const proposalItems: Prisma.ReconciliationCorrectionItemCreateManyProposalInput[] = [];
    for (const requested of input.corrections) {
      if (requested.action === "ADDED") {
        const transactionDate = new Date(`${requested.transactionDate}T00:00:00.000Z`);
        if ((statement.periodFrom && transactionDate < statement.periodFrom)
          || (statement.periodTo && transactionDate > statement.periodTo)) {
          throw new HttpError(400, "Manual adjustment date must be within the opened statement period.");
        }
        assertCampaignClassification({
          eventCode: requested.eventCodeId ? selectedEventById.get(requested.eventCodeId) ?? null : null,
          campaignId: requested.eventCampaignId ?? null,
          campaign: requested.eventCampaignId ? selectedCampaignById.get(requested.eventCampaignId) ?? null : null,
          transactionDate,
          requiresClassification: requested.direction === "INCOMING",
          requireComplete: true
        });
        const event = requested.eventCodeId ? selectedEventById.get(requested.eventCodeId) ?? null : null;
        if (event?.eventType === "TIME_BASED") throw new HttpError(400, "TIME_BASED Event Codes are not available for manual adjustments because they have no MemberIdentity for sponsorship allocation.");
        proposalItems.push({
          action: "ADDED",
          proposedEventCodeId: requested.eventCodeId,
          proposedEventCampaignId: requested.eventCampaignId ?? null,
          proposedRemark: requested.remark?.trim() || null,
          correctionReason: requested.reason.trim(),
          manualTransactionDate: transactionDate,
          manualTransactionType: requested.direction === "INCOMING" ? "CR" : "DB",
          manualDescription: requested.description.trim(),
          manualOriginalAmount: requested.direction === "INCOMING" ? requested.amount : `-${requested.amount}`
        });
        continue;
      }

      const current = currentById.get(requested.transactionId)!;
      if (current.reconciliationExcludedAt) {
        throw new HttpError(400, "An already excluded transaction cannot be corrected again.");
      }
      if (requested.action === "EXCLUDED") {
        proposalItems.push({
          action: "EXCLUDED",
          bankTransactionId: current.id,
          beforeEventCodeId: current.eventCodeId,
          beforeEventCampaignId: current.eventCampaignId,
          proposedEventCodeId: current.eventCodeId,
          proposedEventCampaignId: current.eventCampaignId,
          beforeRemark: current.remark?.trim() || null,
          proposedRemark: current.remark?.trim() || null,
          correctionReason: requested.reason.trim()
        });
        continue;
      }

      const requiresClassification = storedTransactionRequiresClassification(current);
      if (requiresClassification && !requested.eventCodeId) {
        throw new HttpError(400, "Final Event is required for every eligible incoming transaction.");
      }
      if (!requiresClassification && requested.eventCodeId) {
        throw new HttpError(400, "Final Event is not applicable to one or more selected bank transactions.");
      }

      assertCampaignClassification({
        eventCode: requested.eventCodeId ? selectedEventById.get(requested.eventCodeId) ?? null : null,
        campaignId: requested.eventCampaignId ?? null,
        campaign: requested.eventCampaignId ? selectedCampaignById.get(requested.eventCampaignId) ?? null : null,
        transactionDate: current.transactionDate,
        requiresClassification,
        requireComplete: true,
        historicalCampaignId: current.eventCodeId === requested.eventCodeId ? current.eventCampaignId : null
      });
      const event = requested.eventCodeId ? selectedEventById.get(requested.eventCodeId) ?? null : null;
      resolveTimeBasedUnits({ eventCode: event, rule: event?.timeRule ?? null, transaction: current, requiresClassification });

      const normalizedRemark = requested.remark?.trim() || null;
      const currentRemark = current.remark?.trim() || null;
      if (current.eventCodeId === requested.eventCodeId && current.eventCampaignId === (requested.eventCampaignId ?? null) && currentRemark === normalizedRemark) continue;
      proposalItems.push({
        action: "MODIFIED",
        bankTransactionId: current.id,
        beforeEventCodeId: current.eventCodeId,
        beforeEventCampaignId: current.eventCampaignId,
        proposedEventCodeId: requested.eventCodeId,
        proposedEventCampaignId: requested.eventCampaignId ?? null,
        beforeRemark: currentRemark,
        proposedRemark: normalizedRemark
      });
    }

    if (proposalItems.length === 0) {
      throw new HttpError(400, "No Edit Income changes are available to Execute.");
    }

    const approvalConfig = await loadActiveStatementApprovalConfigWithEligibleApprovers(tx);
    if (!approvalConfig) {
      throw new HttpError(400, "Active Approval Configuration for Statement Upload is required before Execute.");
    }
    if (approvalConfig.approvers.length === 0) {
      throw new HttpError(400, "No current eligible configured approver is available for Statement Upload.");
    }

    const now = new Date();
    const statementUpdate = await tx.bankStatementUpload.updateMany({
      where: { id: statement.id, status: "FINALIZED" },
      data: {
        status: "CHECK",
        executedAt: now,
        executedById: input.userId
      }
    });
    if (statementUpdate.count !== 1) {
      throw new HttpError(409, "This statement changed while Execute was running. Reload the Edit Income workspace.");
    }

    const approvalUpdate = await tx.reconciliationApproval.updateMany({
      where: {
        id: statement.approval.id,
        status: statement.approval.status
      },
      data: {
        status: "PENDING",
        submittedAt: now,
        submittedById: input.userId,
        decidedAt: null,
        decidedById: null,
        remark: null
      }
    });
    if (approvalUpdate.count !== 1) {
      throw new HttpError(409, "The approval request changed while Execute was running. Reload the Edit Income workspace.");
    }

    const proposal = await tx.reconciliationCorrectionProposal.create({
      data: {
        approvalId: statement.approval.id,
        statementUploadId: statement.id,
        proposedAt: now,
        proposedById: input.userId,
        items: { createMany: { data: proposalItems } },
        approvers: {
          createMany: {
            data: approvalConfig.approvers.map((assignment) => ({ userId: assignment.approverUserId }))
          }
        }
      },
      select: { id: true }
    });

    await tx.reconciliationApprovalHistory.create({
      data: {
        approvalId: statement.approval.id,
        action: "SUBMITTED",
        remark: "Edit Income correction submitted for re-approval.",
        actionAt: now,
        actionById: input.userId
      }
    });

    return {
      statementId: statement.id,
      approvalId: statement.approval.id,
      proposalId: proposal.id,
      modifiedTransactions: proposalItems.filter((item) => item.action === "MODIFIED").length,
      addedAdjustments: proposalItems.filter((item) => item.action === "ADDED").length,
      excludedTransactions: proposalItems.filter((item) => item.action === "EXCLUDED").length
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
