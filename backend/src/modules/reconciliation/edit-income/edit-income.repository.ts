import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import { storedTransactionRequiresClassification } from "../reconciliation-classification.js";
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
  activeFlag: true
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
  const [statement, eventCodes] = await Promise.all([
    prisma.bankStatementUpload.findUnique({
      where: { id: statementId },
      include: {
        bankAccount: { select: bankAccountSelect },
        uploadedBy: { select: { id: true, fullName: true } },
        finalizedBy: { select: { id: true, fullName: true } },
        transactions: {
          include: {
            suggestedEventCode: { select: eventCodeSelect },
            eventCode: { select: eventCodeSelect }
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
      where: { activeFlag: true },
      select: eventCodeSelect,
      orderBy: [{ code: "asc" }, { eventName: "asc" }]
    })
  ]);

  return { statement, eventCodes };
}

export type EditIncomeCorrectionInput = {
  statementId: string;
  userId: string;
  changes: Array<{
    transactionId: string;
    eventCodeId: string | null;
    remark: string | null;
  }>;
};

export async function executeEditIncomeCorrectionAtomic(input: EditIncomeCorrectionInput) {
  return prisma.$transaction(async (tx) => {
    const statement = await tx.bankStatementUpload.findUnique({
      where: { id: input.statementId },
      select: {
        id: true,
        status: true,
        approval: {
          select: {
            id: true,
            status: true,
            history: {
              where: { action: "APPROVED" },
              select: { id: true },
              take: 1
            }
          }
        },
        transactions: {
          where: { id: { in: input.changes.map((change) => change.transactionId) } },
          select: {
            id: true,
            transactionType: true,
            originalAmount: true,
            eventCodeId: true,
            remark: true
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
    if (statement.transactions.length !== input.changes.length) {
      throw new HttpError(400, "One or more correction transactions do not belong to this statement.");
    }

    const targetEventCodeIds = [...new Set(input.changes.map((change) => change.eventCodeId).filter(Boolean))] as string[];
    const activeEventCodes = targetEventCodeIds.length
      ? await tx.eventCode.findMany({
          where: { id: { in: targetEventCodeIds }, activeFlag: true },
          select: { id: true }
        })
      : [];
    const activeEventCodeIds = new Set(activeEventCodes.map((item) => item.id));
    if (activeEventCodeIds.size !== targetEventCodeIds.length) {
      throw new HttpError(400, "One or more selected Final Events are inactive or no longer available.");
    }

    const currentById = new Map(statement.transactions.map((transaction) => [transaction.id, transaction]));
    const actualChanges: Array<{
      transactionId: string;
      eventCodeId: string | null;
      remark: string | null;
      eventChanged: boolean;
      remarkChanged: boolean;
      oldEventCodeId: string | null;
      oldRemark: string | null;
    }> = [];

    for (const requested of input.changes) {
      const current = currentById.get(requested.transactionId)!;
      const requiresClassification = storedTransactionRequiresClassification(current);
      if (requiresClassification && !requested.eventCodeId) {
        throw new HttpError(400, "Final Event is required for every eligible incoming transaction.");
      }
      if (!requiresClassification && requested.eventCodeId) {
        throw new HttpError(400, "Final Event is not applicable to one or more selected bank transactions.");
      }

      const normalizedRemark = requested.remark?.trim() || null;
      const currentRemark = current.remark?.trim() || null;
      const eventChanged = current.eventCodeId !== requested.eventCodeId;
      const remarkChanged = currentRemark !== normalizedRemark;
      if (!eventChanged && !remarkChanged) continue;

      actualChanges.push({
        transactionId: current.id,
        eventCodeId: requested.eventCodeId,
        remark: normalizedRemark,
        eventChanged,
        remarkChanged,
        oldEventCodeId: current.eventCodeId,
        oldRemark: currentRemark
      });
    }

    if (actualChanges.length === 0) {
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

    for (const change of actualChanges) {
      await tx.bankTransaction.update({
        where: { id: change.transactionId },
        data: {
          eventCodeId: change.eventCodeId,
          remark: change.remark,
          status: "CHECK"
        }
      });

      if (change.eventChanged) {
        await tx.bankTransactionHistory.create({
          data: {
            bankTransactionId: change.transactionId,
            fieldName: "event_code_id",
            oldValue: change.oldEventCodeId,
            newValue: change.eventCodeId,
            remark: "Edit Income correction",
            changedAt: now,
            changedById: input.userId
          }
        });
      }
      if (change.remarkChanged) {
        await tx.bankTransactionHistory.create({
          data: {
            bankTransactionId: change.transactionId,
            fieldName: "remark",
            oldValue: change.oldRemark,
            newValue: change.remark,
            remark: "Edit Income correction",
            changedAt: now,
            changedById: input.userId
          }
        });
      }
    }

    await tx.bankTransaction.updateMany({
      where: { statementUploadId: statement.id, status: "FINALIZED" },
      data: { status: "CHECK" }
    });

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
      modifiedTransactions: actualChanges.length
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
