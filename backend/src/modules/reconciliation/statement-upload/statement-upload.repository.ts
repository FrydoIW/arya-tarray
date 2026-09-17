import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import { storedTransactionRequiresClassification } from "../reconciliation-classification.js";
import { loadActiveStatementApprovalConfigWithEligibleApprovers } from "../reconciliation-approval.js";
import { discoverMemberIdentities } from "../../member/member-identity/member-identity.service.js";
import { memberTransaction } from "../../member/member-identity/member-transaction.js";
import { buildApprovalApproverSnapshot, LEGACY_APPROVAL_SNAPSHOT_MESSAGE } from "../../approval/sign-approval/approval-snapshot.domain.js";
import { canonicalDuplicateSignature, matchDuplicateTransactions, signedAmountCents } from "./statement-upload.duplicate.js";
import { centsToDecimalString } from "./statement-upload.classifier.js";
import { assertCampaignClassification, selectSingleEligibleCampaign } from "../campaign-classification.js";
import { resolveTimeBasedUnits } from "../time-based-classification.js";

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
  eventType: true,
  activeFlag: true,
  timeRule: { select: { unitAmount: true, durationMonths: true, activeFlag: true } }
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
      eventCode: { select: eventCodeSelect },
      eventCampaign: { select: { id: true, campaignName: true } }
    },
    orderBy: [{ rowNo: "asc" as const }, { createdAt: "asc" as const }]
  }
} satisfies Prisma.BankStatementUploadInclude;

export function loadRawStatementsForSummary() {
  return prisma.bankStatementUpload.findMany({
    where: { status: "RAW" },
    select: {
      id: true,
      bankAccountId: true,
      fileName: true,
      periodFrom: true,
      periodTo: true,
      totalTransaction: true,
      status: true,
      uploadedAt: true,
      bankAccount: { select: bankAccountSelect },
      uploadedBy: { select: { id: true, fullName: true } },
      transactions: {
        select: {
          transactionType: true,
          originalAmount: true,
          eventCodeId: true,
          eventCampaignId: true,
          eventCode: { select: { eventType: true } }
        }
      }
    },
    orderBy: [{ uploadedAt: "desc" }, { createdAt: "desc" }]
  });
}

export function buildOverlapCandidateWhere(current: { id: string; bankAccountId: string; periodFrom: Date; periodTo: Date }): Prisma.BankStatementUploadWhereInput {
  return {
    id: { not: current.id },
    bankAccountId: current.bankAccountId,
    status: { not: "WITHDRAWN" },
    periodFrom: { lte: current.periodTo },
    periodTo: { gte: current.periodFrom }
  };
}

export async function loadStatementUploadWorkspaceRecords(statementId?: string) {
  const [bankAccounts, activeEventCodes, campaigns, rawStatements, currentStatement] = await Promise.all([
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
    prisma.eventCampaign.findMany({
      where: { OR: [
        { activeFlag: true, eventCode: { activeFlag: true } },
        ...(statementId ? [{ transactions: { some: { statementUploadId: statementId } } }] : [])
      ] },
      select: { id: true, eventCodeId: true, campaignName: true, startDate: true, endDate: true, activeFlag: true },
      orderBy: [{ startDate: "desc" }, { campaignName: "asc" }]
    }),
    loadRawStatementsForSummary(),
    statementId
      ? prisma.bankStatementUpload.findFirst({ where: { id: statementId, status: "RAW" }, include: statementInclude })
      : Promise.resolve(null)
  ]);

  const overlappingStatements = currentStatement?.periodFrom && currentStatement.periodTo
    ? await prisma.bankStatementUpload.findMany({
        where: buildOverlapCandidateWhere({
          id: currentStatement.id,
          bankAccountId: currentStatement.bankAccountId,
          periodFrom: currentStatement.periodFrom,
          periodTo: currentStatement.periodTo
        }),
        select: { id: true, fileName: true, periodFrom: true, periodTo: true, status: true },
        orderBy: [{ periodFrom: "asc" }, { uploadedAt: "asc" }]
      })
    : [];

  return { bankAccounts, activeEventCodes, campaigns, rawStatements, currentStatement, overlappingStatements };
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
    sourceTransactionNo: number;
    sourceWorksheetRow: number | null;
    sourceSheetName: string | null;
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

export type PersistParsedStatementResult = {
  attemptId: string;
  statementId: string | null;
  sourceTransactionCount: number;
  importedTransactionCount: number;
  duplicateTransactionCount: number;
  sourceTotalCredit: string;
  sourceTotalDebit: string;
  duplicates: Array<{
    matchedStatementUploadId: string;
    matchedStatementFileName: string | null;
    matchedBankTransactionId: string;
    sourceTransactionNo: number;
    sourceWorksheetRow: number | null;
    sourceSheetName: string | null;
    transactionDate: string | null;
    transactionType: string | null;
    referenceNo: string | null;
    senderName: string | null;
    description: string | null;
    originalAmount: string;
    signatureHash: string;
  }>;
};

export async function persistParsedStatement(input: PersistParsedStatementInput): Promise<PersistParsedStatementResult> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const lockedAccount = await tx.$queryRaw<Array<{ bank_account_id: string }>>`
          SELECT bank_account_id FROM arya_bank_account WHERE bank_account_id = ${input.bankAccountId} FOR UPDATE
        `;
        if (lockedAccount.length === 0) {
          throw new HttpError(400, "Selected bank account is inactive or no longer available.");
        }

        const transactionTimes = input.transactions.map((transaction) => transaction.transactionDate.getTime());
        const minDate = new Date(Math.min(...transactionTimes));
        const maxDate = new Date(Math.max(...transactionTimes));

        const existingStatements = await tx.bankStatementUpload.findMany({
          where: { bankAccountId: input.bankAccountId, status: { not: "WITHDRAWN" } },
          select: { id: true, fileName: true }
        });
        const statementIds = existingStatements.map((statement) => statement.id);
        const fileNameByStatementId = new Map(existingStatements.map((statement) => [statement.id, statement.fileName]));

        const existingEvidence = statementIds.length ? await tx.bankTransaction.findMany({
          where: {
            statementUploadId: { in: statementIds },
            sourceType: "BANK",
            transactionDate: { gte: minDate, lte: maxDate }
          },
          select: {
            id: true,
            statementUploadId: true,
            transactionDate: true,
            transactionType: true,
            referenceNo: true,
            senderName: true,
            description: true,
            originalAmount: true
          },
          orderBy: { id: "asc" }
        }) : [];

        const { duplicates, newRows } = matchDuplicateTransactions(input.transactions, existingEvidence);

        const attemptRecord = await tx.bankStatementUploadAttempt.create({
          data: {
            bankAccountId: input.bankAccountId,
            fileName: input.fileName,
            sourceTotalTransaction: input.totalTransaction,
            sourceTotalCredit: new Prisma.Decimal(input.totalCredit),
            sourceTotalDebit: new Prisma.Decimal(input.totalDebit),
            importedTransactionCount: newRows.length,
            duplicateTransactionCount: duplicates.length,
            uploadedById: input.uploadedById
          },
          select: { id: true }
        });

        let statement: { id: string } | null = null;
        if (newRows.length > 0) {
          let importedCreditCents = 0n;
          let importedDebitCents = 0n;
          for (const transaction of newRows) {
            const cents = signedAmountCents(transaction.originalAmount);
            if (cents >= 0n) importedCreditCents += cents;
            else importedDebitCents += -cents;
          }

          const createdStatement = await tx.bankStatementUpload.create({
            data: {
              bankAccountId: input.bankAccountId,
              fileName: input.fileName,
              periodFrom: input.periodFrom,
              periodTo: input.periodTo,
              totalTransaction: newRows.length,
              totalCredit: new Prisma.Decimal(centsToDecimalString(importedCreditCents)),
              totalDebit: new Prisma.Decimal(centsToDecimalString(importedDebitCents)),
              status: "RAW",
              uploadedById: input.uploadedById
            },
            select: { id: true }
          });
          statement = createdStatement;

          const classifiedEventCodeIds = [...new Set(newRows.flatMap((transaction) => transaction.eventCodeId ? [transaction.eventCodeId] : []))];
          const classifiedEventCodes = classifiedEventCodeIds.length ? await tx.eventCode.findMany({
            where: { id: { in: classifiedEventCodeIds } },
            select: { id: true, eventType: true, activeFlag: true }
          }) : [];
          const campaignEventCodeIds = classifiedEventCodes.filter((eventCode) => eventCode.eventType === "CAMPAIGN").map((eventCode) => eventCode.id);
          const campaigns = campaignEventCodeIds.length ? await tx.eventCampaign.findMany({
            where: { eventCodeId: { in: campaignEventCodeIds } },
            select: { id: true, eventCodeId: true, activeFlag: true, startDate: true, endDate: true }
          }) : [];
          const classifiedEventCodeById = new Map(classifiedEventCodes.map((eventCode) => [eventCode.id, eventCode]));

          await tx.bankTransaction.createMany({
            data: newRows.map((transaction) => ({
              statementUploadId: createdStatement.id,
              rowNo: transaction.sourceTransactionNo,
              transactionDate: transaction.transactionDate,
              transactionType: transaction.transactionType,
              referenceNo: transaction.referenceNo,
              senderName: transaction.senderName,
              description: transaction.description,
              originalAmount: new Prisma.Decimal(transaction.originalAmount),
              suffixCode: transaction.suffixCode,
              suggestedEventCodeId: transaction.suggestedEventCodeId,
              eventCodeId: transaction.eventCodeId,
              eventCampaignId: selectSingleEligibleCampaign({
                eventCode: transaction.eventCodeId ? classifiedEventCodeById.get(transaction.eventCodeId) ?? null : null,
                campaigns,
                transactionDate: transaction.transactionDate
              }),
              baseAmount: new Prisma.Decimal(transaction.baseAmount),
              status: "RAW"
            }))
          });

          await tx.bankAccount.updateMany({
            where: {
              id: input.bankAccountId,
              openingBalanceLockedAt: null
            },
            data: { openingBalanceLockedAt: new Date() }
          });

          await tx.bankStatementUploadAttempt.update({
            where: { id: attemptRecord.id },
            data: { statementUploadId: createdStatement.id }
          });
        }

        if (duplicates.length > 0) {
          await tx.bankStatementUploadDuplicate.createMany({
            data: duplicates.map(({ incoming, matched }) => ({
              uploadAttemptId: attemptRecord.id,
              matchedStatementUploadId: matched.statementUploadId,
              matchedBankTransactionId: matched.id,
              sourceTransactionNo: incoming.sourceTransactionNo,
              sourceWorksheetRow: incoming.sourceWorksheetRow,
              sourceSheetName: incoming.sourceSheetName,
              transactionDate: incoming.transactionDate,
              transactionType: incoming.transactionType,
              referenceNo: incoming.referenceNo,
              senderName: incoming.senderName,
              sourceDescription: incoming.description,
              originalAmount: new Prisma.Decimal(incoming.originalAmount),
              signatureHash: canonicalDuplicateSignature(incoming)
            }))
          });
        }

        const statementResult: PersistParsedStatementResult = {
          attemptId: attemptRecord.id,
          statementId: statement?.id ?? null,
          sourceTransactionCount: input.totalTransaction,
          importedTransactionCount: newRows.length,
          duplicateTransactionCount: duplicates.length,
          sourceTotalCredit: input.totalCredit,
          sourceTotalDebit: input.totalDebit,
          duplicates: duplicates.map(({ incoming, matched }) => ({
            matchedStatementUploadId: matched.statementUploadId,
            matchedStatementFileName: fileNameByStatementId.get(matched.statementUploadId) ?? null,
            matchedBankTransactionId: matched.id,
            sourceTransactionNo: incoming.sourceTransactionNo,
            sourceWorksheetRow: incoming.sourceWorksheetRow,
            sourceSheetName: incoming.sourceSheetName,
            transactionDate: incoming.transactionDate ? incoming.transactionDate.toISOString().slice(0, 10) : null,
            transactionType: incoming.transactionType,
            referenceNo: incoming.referenceNo,
            senderName: incoming.senderName,
            description: incoming.description,
            originalAmount: incoming.originalAmount,
            signatureHash: canonicalDuplicateSignature(incoming)
          }))
        };
        return statementResult;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryableConflict = error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || (error.code === "P2010" && ["1213", "1205"].includes(String(error.meta?.code))));
      if (!retryableConflict || attempt === 4) throw error;
    }
  }

  throw new Error("Statement persistence retry limit reached");
}

export function resolveRemarkUpdate(current: string | null, incoming: string | undefined) {
  const next = incoming === undefined ? current : incoming.trim() || null;
  return { next: next ?? null, changed: (current ?? null) !== (next ?? null) };
}

export async function updateTransactionFinalEventAtomic(input: {
  statementId: string;
  transactionId: string;
  eventCodeId: string | null;
  eventCampaignId?: string | null;
  remark?: string;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.bankTransaction.findFirst({
      where: { id: input.transactionId, statementUploadId: input.statementId },
      include: {
        statementUpload: { select: { id: true, status: true } },
        suggestedEventCode: { select: eventCodeSelect },
        eventCode: { select: eventCodeSelect },
        eventCampaign: { select: { id: true, campaignName: true } }
      }
    });

    if (!current) throw new HttpError(404, "Bank transaction not found in the selected statement");
    if (current.statementUpload.status !== "RAW") {
      throw new HttpError(409, "This statement is no longer a Draft. Reload the Statement Upload workspace.");
    }
    if (!storedTransactionRequiresClassification(current) && input.eventCodeId) {
      throw new HttpError(400, "Final Event is not applicable to this bank transaction.");
    }

    if (input.eventCodeId) {
      const eventCode = await tx.eventCode.findFirst({
        where: { id: input.eventCodeId, activeFlag: true },
        select: { id: true, eventType: true, activeFlag: true, timeRule: { select: { unitAmount: true, durationMonths: true, activeFlag: true } } }
      });
      if (!eventCode) throw new HttpError(400, "The selected Final Event is inactive or no longer available.");
      const campaign = input.eventCampaignId ? await tx.eventCampaign.findUnique({
        where: { id: input.eventCampaignId },
        select: { id: true, eventCodeId: true, activeFlag: true, startDate: true, endDate: true }
      }) : null;
      assertCampaignClassification({
        eventCode,
        campaignId: input.eventCampaignId ?? null,
        campaign,
        transactionDate: current.transactionDate,
        requiresClassification: storedTransactionRequiresClassification(current),
        requireComplete: false,
        historicalCampaignId: current.eventCodeId === input.eventCodeId ? current.eventCampaignId : null
      });
      resolveTimeBasedUnits({ eventCode, rule: eventCode.timeRule, transaction: current, requiresClassification: storedTransactionRequiresClassification(current) });
    } else if (input.eventCampaignId) {
      throw new HttpError(400, "Campaign requires a Final Event");
    }

    const remarkUpdate = resolveRemarkUpdate(current.remark, input.remark);
    if (current.eventCodeId === input.eventCodeId
      && current.eventCampaignId === (input.eventCampaignId ?? null)
      && !remarkUpdate.changed) return current;

    const updated = await tx.bankTransaction.update({
      where: { id: current.id },
      data: {
        eventCodeId: input.eventCodeId,
        eventCampaignId: input.eventCampaignId ?? null,
        remark: remarkUpdate.next
      },
      include: {
        statementUpload: { select: { id: true, status: true } },
        suggestedEventCode: { select: eventCodeSelect },
        eventCode: { select: eventCodeSelect },
        eventCampaign: { select: { id: true, campaignName: true } }
      }
    });

    if (current.eventCodeId !== input.eventCodeId) await tx.bankTransactionHistory.create({
      data: {
        bankTransactionId: current.id,
        fieldName: "event_code_id",
        oldValue: current.eventCodeId,
        newValue: input.eventCodeId,
        remark: input.remark ?? null,
        changedById: input.userId
      }
    });
    if (current.eventCampaignId !== (input.eventCampaignId ?? null)) await tx.bankTransactionHistory.create({
      data: {
        bankTransactionId: current.id,
        fieldName: "event_campaign_id",
        oldValue: current.eventCampaignId,
        newValue: input.eventCampaignId ?? null,
        remark: input.remark ?? null,
        changedById: input.userId
      }
    });
    if (remarkUpdate.changed) await tx.bankTransactionHistory.create({
      data: {
        bankTransactionId: current.id,
        fieldName: "remark",
        oldValue: current.remark ?? null,
        newValue: remarkUpdate.next,
        remark: null,
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
            baseAmount: true,
            eventCodeId: true,
            eventCampaignId: true,
            eventCode: { select: { id: true, eventType: true, activeFlag: true, timeRule: { select: { unitAmount: true, durationMonths: true, activeFlag: true } } } },
            eventCampaign: { select: { id: true, eventCodeId: true, activeFlag: true, startDate: true, endDate: true } },
            transactionDate: true
          }
        },
        approval: {
          select: {
            id: true,
            status: true,
            _count: { select: { approvers: true } }
          }
        }
      }
    });

    if (!statement) throw new HttpError(404, "Statement not found");
    if (statement.status !== "RAW") {
      throw new HttpError(409, "This statement is no longer a Draft. Reload the Statement Upload workspace.");
    }
    if (statement.transactions.length === 0) {
      throw new HttpError(400, "This statement has no transactions to submit for approval.");
    }

    const unresolvedCount = statement.transactions.filter((transaction) =>
      storedTransactionRequiresClassification(transaction) && (!transaction.eventCodeId || (transaction.eventCode?.eventType === "CAMPAIGN" && !transaction.eventCampaignId))
    ).length;

    if (unresolvedCount > 0) {
      throw new HttpError(
        400,
        `${unresolvedCount} transaction${unresolvedCount === 1 ? "" : "s"} still require Final Event classification.`
      );
    }

    for (const transaction of statement.transactions) {
      if (!storedTransactionRequiresClassification(transaction) || !transaction.eventCodeId) continue;
      assertCampaignClassification({
        eventCode: transaction.eventCode,
        campaignId: transaction.eventCampaignId,
        campaign: transaction.eventCampaign,
        transactionDate: transaction.transactionDate,
        requiresClassification: true,
        requireComplete: true,
        historicalCampaignId: null
      });
      resolveTimeBasedUnits({ eventCode: transaction.eventCode, rule: transaction.eventCode?.timeRule ?? null, transaction, requiresClassification: true });
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
      await tx.reconciliationApprovalApprover.createMany({
        data: buildApprovalApproverSnapshot(approvalId, approvalConfig.approvers)
      });
    } else if (statement.approval.status === "REJECTED") {
      if (statement.approval._count.approvers === 0) {
        throw new HttpError(409, LEGACY_APPROVAL_SNAPSHOT_MESSAGE);
      }
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

export type WithdrawStatementResult = {
  statementId: string;
  bankAccountId: string;
  remainingStatementCount: number;
  openingBalanceUnlocked: boolean;
};

export async function withdrawStatementAtomic(input: { statementId: string; reason: string; userId: string }): Promise<WithdrawStatementResult> {
  const reason = input.reason.trim();
  if (!reason) throw new HttpError(400, "Withdrawal reason is required.");

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const statement = await tx.bankStatementUpload.findUnique({
          where: { id: input.statementId },
          select: { id: true, bankAccountId: true }
        });
        if (!statement) throw new HttpError(404, "Statement not found");

        const lockedAccount = await tx.$queryRaw<Array<{ bank_account_id: string }>>`
          SELECT bank_account_id FROM arya_bank_account WHERE bank_account_id = ${statement.bankAccountId} FOR UPDATE
        `;
        if (lockedAccount.length === 0) {
          throw new HttpError(409, "The bank account for this draft is no longer available.");
        }

        const now = new Date();
        const withdrawal = await tx.bankStatementUpload.updateMany({
          where: { id: statement.id, status: "RAW" },
          data: {
            status: "WITHDRAWN",
            withdrawnAt: now,
            withdrawnById: input.userId,
            withdrawalReason: reason
          }
        });
        if (withdrawal.count !== 1) {
          throw new HttpError(409, "Only a RAW draft can be withdrawn. Reload the Statement Upload workspace.");
        }

        const remainingStatementCount = await tx.bankStatementUpload.count({
          where: { bankAccountId: statement.bankAccountId, status: { not: "WITHDRAWN" } }
        });

        let openingBalanceUnlocked = false;
        if (remainingStatementCount === 0) {
          await tx.bankAccount.updateMany({
            where: { id: statement.bankAccountId, openingBalanceLockedAt: { not: null } },
            data: { openingBalanceLockedAt: null }
          });
          openingBalanceUnlocked = true;
        }

        return { statementId: statement.id, bankAccountId: statement.bankAccountId, remainingStatementCount, openingBalanceUnlocked };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryableConflict = error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || (error.code === "P2010" && ["1213", "1205"].includes(String(error.meta?.code))));
      if (!retryableConflict || attempt === 4) throw error;
    }
  }

  throw new Error("Statement withdrawal retry limit reached");
}
