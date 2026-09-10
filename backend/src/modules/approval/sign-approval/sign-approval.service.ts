import { HttpError } from "../../../lib/http.js";
import type { ApproveDecisionInput, RejectDecisionInput } from "./sign-approval.schema.js";
import {
  decideSignApprovalAtomic,
  loadSignApprovalDetail as loadSignApprovalDetailRecord,
  loadSignApprovalWorkspace as loadSignApprovalWorkspaceRecords
} from "./sign-approval.repository.js";

type WorkspaceRecords = Awaited<ReturnType<typeof loadSignApprovalWorkspaceRecords>>;
type ApprovalQueueRecord = WorkspaceRecords["approvals"][number];
type DetailRecords = Awaited<ReturnType<typeof loadSignApprovalDetailRecord>>;

function decimalToString(value: { toString(): string }) {
  return value.toString();
}

function decimalToCents(value: { toString(): string }) {
  const raw = value.toString();
  const negative = raw.startsWith("-");
  const normalized = negative ? raw.slice(1) : raw;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
  return negative ? -cents : cents;
}

function centsToDecimal(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${cents}`;
}

function absoluteCents(value: { toString(): string }) {
  const cents = decimalToCents(value);
  return cents < 0n ? -cents : cents;
}

function sumAbsoluteAmounts(rows: Array<{ originalAmount: { toString(): string } }>) {
  return rows.reduce((total, row) => total + absoluteCents(row.originalAmount), 0n);
}

function totalAmount(totalCredit: { toString(): string }, totalDebit: { toString(): string }) {
  return centsToDecimal(decimalToCents(totalCredit) + decimalToCents(totalDebit));
}

function mapQueueItem(item: ApprovalQueueRecord) {
  return {
    approvalId: item.id,
    statement: {
      id: item.statementUpload.id,
      bankAccount: item.statementUpload.bankAccount,
      periodFrom: item.statementUpload.periodFrom,
      periodTo: item.statementUpload.periodTo,
      totalTransaction: item.statementUpload.totalTransaction,
      totalAmount: totalAmount(item.statementUpload.totalCredit, item.statementUpload.totalDebit),
      totalCredit: decimalToString(item.statementUpload.totalCredit),
      totalDebit: decimalToString(item.statementUpload.totalDebit),
      status: item.statementUpload.status,
      uploadedBy: item.statementUpload.uploadedBy
    },
    submittedAt: item.submittedAt,
    status: item.status,
    decidedAt: item.decidedAt,
    decidedBy: item.decidedBy
  };
}

export async function getSignApprovalWorkspace(userId: string) {
  const workspace = await loadSignApprovalWorkspaceRecords(userId);

  return {
    eligible: workspace.eligible,
    summary: workspace.summary,
    approvals: workspace.approvals.map(mapQueueItem)
  };
}

function ensureEligibleDetail(records: DetailRecords) {
  if (!records.eligible) {
    throw new HttpError(403, "You are not an eligible configured approver for Statement Upload");
  }
  if (!records.approval || !records.approvers) throw new HttpError(404, "Approval request not found");
  return { approval: records.approval, approvers: records.approvers };
}

export async function getSignApprovalDetail(approvalId: string, userId: string) {
  const records = await loadSignApprovalDetailRecord(approvalId, userId);
  const { approval, approvers } = ensureEligibleDetail(records);
  const statement = approval.statementUpload;
  const correctionProposal = records.correctionProposal;
  const correctionItems = correctionProposal?.items ?? [];
  // Statement total is gross bank activity (credit + absolute debit). Manual
  // and exclusion impact must therefore also use absolute movement amounts.
  const currentReconciledTotalCents = decimalToCents(statement.totalCredit) + decimalToCents(statement.totalDebit)
    + sumAbsoluteAmounts(records.approvedManualAdjustments ?? [])
    - sumAbsoluteAmounts(records.approvedExcludedBankTransactions ?? []);
  const proposedTotalCents = correctionItems.reduce((total, item) => {
    if (item.action === "ADDED" && item.manualOriginalAmount) return total + absoluteCents(item.manualOriginalAmount);
    if (item.action === "EXCLUDED" && item.bankTransaction) return total - absoluteCents(item.bankTransaction.originalAmount);
    return total;
  }, currentReconciledTotalCents);

  return {
    approval: {
      id: approval.id,
      status: approval.status,
      submittedAt: approval.submittedAt,
      submittedBy: approval.submittedBy,
      decidedAt: approval.decidedAt,
      decidedBy: approval.decidedBy,
      remark: approval.remark,
      canDecide: approval.status === "PENDING"
    },
    statement: {
      id: statement.id,
      bankAccount: statement.bankAccount,
      periodFrom: statement.periodFrom,
      periodTo: statement.periodTo,
      status: statement.status,
      uploadedBy: statement.uploadedBy,
      totalTransaction: statement._count.transactions,
      totalAmount: totalAmount(statement.totalCredit, statement.totalDebit)
    },
    configuredApprovers: approvers.map((assignment) => ({
      id: assignment.user.id,
      fullName: assignment.user.fullName,
      email: assignment.user.email
    })),
    correctionProposal: correctionProposal ? {
      id: correctionProposal.id,
      status: correctionProposal.status,
      proposedAt: correctionProposal.proposedAt,
      proposedBy: correctionProposal.proposedBy,
      decidedAt: correctionProposal.decidedAt,
      decidedBy: correctionProposal.decidedBy,
      originalStatementAmount: totalAmount(statement.totalCredit, statement.totalDebit),
      currentOfficialAmount: centsToDecimal(currentReconciledTotalCents),
      proposedCorrectedAmount: centsToDecimal(proposedTotalCents),
      summary: {
        modifiedTransactions: correctionItems.filter((item) => item.action === "MODIFIED").length,
        addedAdjustments: correctionItems.filter((item) => item.action === "ADDED").length,
        excludedTransactions: correctionItems.filter((item) => item.action === "EXCLUDED").length
      },
      items: correctionItems.map((item) => ({
        id: item.id,
        action: item.action,
        transaction: item.bankTransaction ? {
          id: item.bankTransaction.id,
          rowNo: item.bankTransaction.rowNo,
          transactionDate: item.bankTransaction.transactionDate,
          referenceNo: item.bankTransaction.referenceNo,
          description: item.bankTransaction.description,
          originalAmount: decimalToString(item.bankTransaction.originalAmount),
          sourceType: item.bankTransaction.sourceType
        } : null,
        beforeEvent: item.beforeEventCode,
        proposedEvent: item.proposedEventCode,
        beforeRemark: item.beforeRemark,
        proposedRemark: item.proposedRemark,
        correctionReason: item.correctionReason,
        manualTransactionDate: item.manualTransactionDate,
        manualTransactionType: item.manualTransactionType,
        manualDescription: item.manualDescription,
        manualOriginalAmount: item.manualOriginalAmount ? decimalToString(item.manualOriginalAmount) : null
      }))
    } : null,
    summary: {
      totalTransactions: statement._count.transactions,
      totalAmount: totalAmount(statement.totalCredit, statement.totalDebit),
      checkedTransactions: records.checkedTransactions,
      needsReviewTransactions: records.needsReviewTransactions
    },
    transactionPreview: statement.transactions.map((transaction) => ({
      id: transaction.id,
      rowNo: transaction.rowNo,
      transactionDate: transaction.transactionDate,
      description: transaction.description,
      originalAmount: decimalToString(transaction.originalAmount),
      suggestedEvent: transaction.suggestedEventCode
        ? {
            id: transaction.suggestedEventCode.id,
            code: transaction.suggestedEventCode.code,
            eventName: transaction.suggestedEventCode.eventName
          }
        : null,
      finalEvent: transaction.eventCode
        ? {
            id: transaction.eventCode.id,
            code: transaction.eventCode.code,
            eventName: transaction.eventCode.eventName
          }
        : null,
      status: transaction.status
    })),
    history: approval.history.map((item) => ({
      id: item.id,
      action: item.action,
      remark: item.remark,
      actionAt: item.actionAt,
      actionBy: item.actionBy
    }))
  };
}

export async function approveSignApproval(
  approvalId: string,
  input: ApproveDecisionInput,
  userId: string
) {
  const result = await decideSignApprovalAtomic({
    approvalId,
    userId,
    decision: "APPROVED",
    remark: input.remark
  });

  return {
    approvalId: result.id,
    status: result.status,
    decidedAt: result.decidedAt,
    decidedBy: result.decidedBy,
    remark: result.remark,
    statement: result.statementUpload
  };
}

export async function rejectSignApproval(
  approvalId: string,
  input: RejectDecisionInput,
  userId: string
) {
  const result = await decideSignApprovalAtomic({
    approvalId,
    userId,
    decision: "REJECTED",
    remark: input.remark
  });

  return {
    approvalId: result.id,
    status: result.status,
    decidedAt: result.decidedAt,
    decidedBy: result.decidedBy,
    remark: result.remark,
    statement: result.statementUpload
  };
}
