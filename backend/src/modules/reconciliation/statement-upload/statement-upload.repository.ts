import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import { storedTransactionRequiresClassification } from "../reconciliation-classification.js";
import { loadActiveStatementApprovalConfigWithEligibleApprovers } from "../reconciliation-approval.js";
import { discoverMemberIdentities } from "../../member/member-identity/member-identity.service.js";
import { memberTransaction } from "../../member/member-identity/member-transaction.js";

const bankAccountSelect = {
  id: true,
  bankCode: true,
  bankName: true,
  accountNo: true,
  accountName: true,
  currencyCode: true,
  activeFlag: true
} as const;

const eventCodeSelect = {
  id: true,
  code: true,
  eventName: true,
  activeFlag: true
} as const;

const statementInclude = {
  bankAccount: { select: bankAccountSelect },
  uploadedBy: { select: { id: true, fullName: true } },
  approval: {
    select: {
      id: true,
      status: true,
      remark: true,
      submittedAt: true,
      decidedAt: true
    }
  },
  transactions: {
    include: {
      suggestedEventCode: { select: eventCodeSelect },
      eventCode: { select: eventCodeSelect }
    },
    orderBy: [{ rowNo: "asc" as const }, { createdAt: "asc" as const }]
  }
} satisfies Prisma.BankStatementUploadInclude;

async function findDefaultCurrentStatement() {
  const raw = await prisma.bankStatementUpload.findFirst({
    where: { status: "RAW" },
    include: statementInclude,
    orderBy: [{ uploadedAt: "desc" }, { createdAt: "desc" }]
  });
  if (raw) return raw;

  const check = await prisma.bankStatementUpload.findFirst({
    where: { status: "CHECK" },
    include: statementInclude,
    orderBy: [{ uploadedAt: "desc" }, { createdAt: "desc" }]
  });
  if (check) return check;

  return prisma.bankStatementUpload.findFirst({
    include: statementInclude,
    orderBy: [{ uploadedAt: "desc" }, { createdAt: "desc" }]
  });
}

export function loadRawStatementsForSummary() {
  return prisma.bankStatementUpload.findMany({
    where: { status: "RAW" },
    select: {
      id: true,
      transactions: {
        select: {
          transactionType: true,
          originalAmount: true,
          eventCodeId: true
        }
      }
    },
    orderBy: [{ uploadedAt: "desc" }, { createdAt: "desc" }]
  });
}

export async function loadStatementUploadWorkspaceRecords(statementId?: string) {
  const [bankAccounts, activeEventCodes, rawStatements, currentStatement] = await Promise.all([
    prisma.bankAccount.findMany({
      where: { activeFlag: true },
      select: bankAccountSelect,
      orderBy: [{ bankName: "asc" }, { accountNo: "asc" }]
    }),
    prisma.eventCode.findMany({
      where: { activeFlag: true },
      select: eventCodeSelect,
      orderBy: [{ code: "asc" }, { eventName: "asc" }]
    }),
    loadRawStatementsForSummary(),
    statementId
      ? prisma.bankStatementUpload.findUnique({ where: { id: statementId }, include: statementInclude })
      : findDefaultCurrentStatement()
  ]);

  return { bankAccounts, activeEventCodes, rawStatements, currentStatement };
}

export function findActiveBankAccount(bankAccountId: string) {
  return prisma.bankAccount.findFirst({
    where: { id: bankAccountId, activeFlag: true },
    select: bankAccountSelect
  });
}

export function listActiveEventCodesForClassification() {
  return prisma.eventCode.findMany({
    where: { activeFlag: true },
    select: eventCodeSelect,
    orderBy: { code: "asc" }
  });
}

export function findPotentialDuplicateStatement(input: {
  bankAccountId: string;
  fileName: string;
  periodFrom: Date;
  periodTo: Date;
  totalTransaction: number;
  totalCredit: string;
  totalDebit: string;
}) {
  return prisma.bankStatementUpload.findFirst({
    where: {
      bankAccountId: input.bankAccountId,
      fileName: input.fileName,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      totalTransaction: input.totalTransaction,
      totalCredit: new Prisma.Decimal(input.totalCredit),
      totalDebit: new Prisma.Decimal(input.totalDebit)
    },
    select: { id: true, status: true, uploadedAt: true }
  });
}

export type PersistParsedStatementInput = {
  bankAccountId: string;
  fileName: string;
  periodFrom: Date;
  periodTo: Date;
  totalTransaction: number;
  totalCredit: string;
  totalDebit: string;
  uploadedById: string;
  transactions: Array<{
    rowNo: number;
    transactionDate: Date;
    transactionType: string;
    referenceNo: string | null;
    senderName: string | null;
    description: string | null;
    originalAmount: string;
    suffixCode: string | null;
    suggestedEventCodeId: string | null;
    eventCodeId: string | null;
    baseAmount: string;
  }>;
};

export async function persistParsedStatement(input: PersistParsedStatementInput) {
  return prisma.$transaction(async (tx) => {
    const statement = await tx.bankStatementUpload.create({
      data: {
        bankAccountId: input.bankAccountId,
        fileName: input.fileName,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        totalTransaction: input.totalTransaction,
        totalCredit: new Prisma.Decimal(input.totalCredit),
        totalDebit: new Prisma.Decimal(input.totalDebit),
        status: "RAW",
        uploadedById: input.uploadedById
      },
      select: { id: true }
    });

    await tx.bankTransaction.createMany({
      data: input.transactions.map((transaction) => ({
        statementUploadId: statement.id,
        rowNo: transaction.rowNo,
        transactionDate: transaction.transactionDate,
        transactionType: transaction.transactionType,
        referenceNo: transaction.referenceNo,
        senderName: transaction.senderName,
        description: transaction.description,
        originalAmount: new Prisma.Decimal(transaction.originalAmount),
        suffixCode: transaction.suffixCode,
        suggestedEventCodeId: transaction.suggestedEventCodeId,
        eventCodeId: transaction.eventCodeId,
        baseAmount: new Prisma.Decimal(transaction.baseAmount),
        status: "RAW"
      }))
    });

    return statement;
  });
}

export async function updateTransactionFinalEventAtomic(input: {
  transactionId: string;
  eventCodeId: string | null;
  remark?: string;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.bankTransaction.findUnique({
      where: { id: input.transactionId },
      include: {
        statementUpload: { select: { id: true, status: true } },
        suggestedEventCode: { select: eventCodeSelect },
        eventCode: { select: eventCodeSelect }
      }
    });

    if (!current) throw new HttpError(404, "Bank transaction not found");
    if (current.statementUpload.status !== "RAW") {
      throw new HttpError(409, "This statement is no longer a Draft. Reload the Statement Upload workspace.");
    }
    if (!storedTransactionRequiresClassification(current) && input.eventCodeId) {
      throw new HttpError(400, "Final Event is not applicable to this bank transaction.");
    }

    if (input.eventCodeId) {
      const eventCode = await tx.eventCode.findFirst({
        where: { id: input.eventCodeId, activeFlag: true },
        select: { id: true }
      });
      if (!eventCode) throw new HttpError(400, "The selected Final Event is inactive or no longer available.");
    }

    if (current.eventCodeId === input.eventCodeId) return current;

    const updated = await tx.bankTransaction.update({
      where: { id: current.id },
      data: {
        eventCodeId: input.eventCodeId,
        remark: input.remark ?? current.remark
      },
      include: {
        statementUpload: { select: { id: true, status: true } },
        suggestedEventCode: { select: eventCodeSelect },
        eventCode: { select: eventCodeSelect }
      }
    });

    await tx.bankTransactionHistory.create({
      data: {
        bankTransactionId: current.id,
        fieldName: "event_code_id",
        oldValue: current.eventCodeId,
        newValue: input.eventCodeId,
        remark: input.remark ?? null,
        changedById: input.userId
      }
    });

    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function executeStatementAtomic(input: { statementId: string; userId: string }) {
  return memberTransaction(async (tx) => {
    const statement = await tx.bankStatementUpload.findUnique({
      where: { id: input.statementId },
      select: {
        id: true,
        status: true,
        transactions: {
          select: {
            id: true,
            senderName: true,
            statementUploadId: true,
            createdAt: true,
            memberIdentityId: true,
            transactionType: true,
            originalAmount: true,
            eventCodeId: true
          }
        },
        approval: {
          select: {
            id: true,
            status: true
          }
        }
      }
    });

    if (!statement) throw new HttpError(404, "Statement not found");
    if (statement.status !== "RAW") {
      throw new HttpError(409, "This statement is no longer a Draft. Reload the Statement Upload workspace.");
    }

    const unresolvedCount = statement.transactions.filter((transaction) =>
      storedTransactionRequiresClassification(transaction) && !transaction.eventCodeId
    ).length;

    if (unresolvedCount > 0) {
      throw new HttpError(
        400,
        `${unresolvedCount} transaction${unresolvedCount === 1 ? "" : "s"} still require Final Event classification.`
      );
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
      where: { id: statement.id, status: "RAW" },
      data: {
        status: "CHECK",
        executedAt: now,
        executedById: input.userId
      }
    });

    if (statementUpdate.count !== 1) {
      throw new HttpError(409, "This statement changed while Execute was running. Reload the Statement Upload workspace.");
    }

    await tx.bankTransaction.updateMany({
      where: { statementUploadId: statement.id },
      data: { status: "CHECK" }
    });

    let approvalId: string;
    if (!statement.approval) {
      const approval = await tx.reconciliationApproval.create({
        data: {
          statementUploadId: statement.id,
          status: "PENDING",
          submittedAt: now,
          submittedById: input.userId
        },
        select: { id: true }
      });
      approvalId = approval.id;
    } else if (statement.approval.status === "REJECTED") {
      const approval = await tx.reconciliationApproval.update({
        where: { id: statement.approval.id },
        data: {
          status: "PENDING",
          submittedAt: now,
          submittedById: input.userId,
          decidedAt: null,
          decidedById: null,
          remark: null
        },
        select: { id: true }
      });
      approvalId = approval.id;
    } else {
      throw new HttpError(409, "This statement already has an active or completed approval request.");
    }

    await tx.reconciliationApprovalHistory.create({
      data: {
        approvalId,
        action: "SUBMITTED",
        actionAt: now,
        actionById: input.userId
      }
    });

    const memberDiscovery = await discoverMemberIdentities(tx, statement.transactions, input.userId);
    return { statementId: statement.id, approvalId, memberDiscovery };
  });
}
