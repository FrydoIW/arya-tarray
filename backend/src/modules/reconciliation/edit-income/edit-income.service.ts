import { currentBusinessDayValue, currentBusinessMonthValue } from "../../../lib/business-time.js";
import { HttpError } from "../../../lib/http.js";
import { centsToDecimal } from "../../../lib/money.js";
import { resolvePeriod } from "../../../lib/period.js";
import type { EditIncomeWorkspaceQuery, ExecuteEditIncomeInput } from "./edit-income.schema.js";
import {
  executeEditIncomeCorrectionAtomic,
  loadEditIncomeDetailRecord,
  loadEditIncomeWorkspaceRecords
} from "./edit-income.repository.js";
import { storedTransactionRequiresClassification } from "../reconciliation-classification.js";
import { timeBasedPaymentPreview } from "../../member/time-based/time-based-preview.js";

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

function totalAmount(totalCredit: { toString(): string }, totalDebit: { toString(): string }) {
  return centsToDecimal(decimalToCents(totalCredit) + decimalToCents(totalDebit));
}

function mapStatement(item: Awaited<ReturnType<typeof loadEditIncomeWorkspaceRecords>>["statements"][number]) {
  const hasPriorApproval = Boolean(item.approval?.history.length);
  const correctionPending = item.status === "CHECK" && item.approval?.status === "PENDING" && hasPriorApproval;
  return {
    id: item.id,
    fileName: item.fileName,
    bankAccount: item.bankAccount,
    periodFrom: item.periodFrom,
    periodTo: item.periodTo,
    totalTransaction: item.totalTransaction,
    totalAmount: totalAmount(item.totalCredit, item.totalDebit),
    status: item.status,
    displayStatus: correctionPending ? "PENDING_REAPPROVAL" : "COMPLETE",
    uploadedAt: item.uploadedAt,
    uploadedBy: item.uploadedBy,
    finalizedAt: item.finalizedAt,
    approvalStatus: item.approval?.status ?? null,
    editable: item.status === "FINALIZED"
  };
}

export async function getEditIncomeWorkspace(input: EditIncomeWorkspaceQuery) {
  const periodMode = input.periodMode ?? "MONTH";
  const month = input.month ?? currentBusinessMonthValue();
  const date = input.date ?? (periodMode === "MONTH" ? `${month}-01` : currentBusinessDayValue());
  const period = resolvePeriod(periodMode, month, date);
  const records = await loadEditIncomeWorkspaceRecords({ mode: period.mode, start: period.start, end: period.end });
  const statements = records.statements.map(mapStatement);
  const finalized = statements.filter((item) => item.status === "FINALIZED");
  const pendingReapproval = statements.filter((item) => item.displayStatus === "PENDING_REAPPROVAL");
  const bankAccounts = [...new Map(statements.map((item) => [item.bankAccount.id, item.bankAccount])).values()]
    .sort((a, b) => `${a.bankName}${a.accountNo}`.localeCompare(`${b.bankName}${b.accountNo}`));

  return {
    periodMode: period.mode,
    month: period.month,
    date: period.date,
    summary: {
      finalizedStatements: finalized.length,
      totalTransactions: finalized.reduce((total, item) => total + item.totalTransaction, 0),
      pendingReapproval: pendingReapproval.length
    },
    statements,
    bankAccounts
  };
}

export async function getEditIncomeDetail(statementId: string) {
  const records = await loadEditIncomeDetailRecord(statementId);
  const statement = records.statement;
  if (!statement) throw new HttpError(404, "Statement not found");
  if (!statement.approval?.history.some((item) => item.action === "APPROVED")) {
    throw new HttpError(409, "Edit Income is only available for statements that have been approved before.");
  }

  return {
    statement: {
      id: statement.id,
      fileName: statement.fileName,
      bankAccount: statement.bankAccount,
      periodFrom: statement.periodFrom,
      periodTo: statement.periodTo,
      totalTransaction: statement.totalTransaction,
      totalAmount: totalAmount(statement.totalCredit, statement.totalDebit),
      status: statement.status,
      displayStatus: statement.status === "CHECK" && statement.approval.status === "PENDING"
        ? "PENDING_REAPPROVAL"
        : "COMPLETE",
      uploadedAt: statement.uploadedAt,
      uploadedBy: statement.uploadedBy,
      finalizedAt: statement.finalizedAt,
      finalizedBy: statement.finalizedBy,
      approvalStatus: statement.approval.status,
      editable: statement.status === "FINALIZED"
    },
    eventCodes: records.eventCodes.map((item) => ({ id: item.id, code: item.code, eventName: item.eventName, eventType: item.eventType, activeFlag: item.activeFlag, timeRule: item.timeRule ? { unitAmount: item.timeRule.unitAmount.toString(), durationMonths: item.timeRule.durationMonths, activeFlag: item.timeRule.activeFlag } : null })),
    campaigns: records.campaigns.map((item) => ({
      id: item.id, eventCodeId: item.eventCodeId, campaignName: item.campaignName,
      startDate: item.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: item.endDate?.toISOString().slice(0, 10) ?? null,
      activeFlag: item.activeFlag
    })),
    transactions: statement.transactions.map((transaction) => ({
      id: transaction.id,
      rowNo: transaction.rowNo ?? 0,
      transactionDate: transaction.transactionDate,
      transactionType: transaction.transactionType ?? "",
      referenceNo: transaction.referenceNo,
      senderName: transaction.senderName,
      description: transaction.description ?? "",
      originalAmount: decimalToString(transaction.originalAmount),
      suffixCode: transaction.suffixCode,
      suggestedEventCodeId: transaction.suggestedEventCodeId,
      eventCodeId: transaction.eventCodeId,
      eventCampaignId: transaction.eventCampaignId,
      baseAmount: transaction.baseAmount ? decimalToString(transaction.baseAmount) : null,
      sponsorship: timeBasedPaymentPreview(transaction),
      remark: transaction.remark,
      sourceType: transaction.sourceType,
      correctionReason: transaction.correctionReason,
      reconciliationExcludedAt: transaction.reconciliationExcludedAt,
      reconciliationExclusionReason: transaction.reconciliationExclusionReason,
      requiresClassification: storedTransactionRequiresClassification(transaction)
    })),
    approvalHistory: statement.approval.history.map((item) => ({
      id: item.id,
      action: item.action,
      remark: item.remark,
      actionAt: item.actionAt,
      actionBy: item.actionBy
    }))
  };
}

export async function executeEditIncome(statementId: string, input: ExecuteEditIncomeInput, userId: string) {
  const result = await executeEditIncomeCorrectionAtomic({
    statementId,
    userId,
    corrections: input.corrections
  });
  const totalChanges = result.modifiedTransactions + result.addedAdjustments + result.excludedTransactions;
  return {
    ...result,
    status: "CHECK",
    message: `${totalChanges} correction${totalChanges === 1 ? "" : "s"} submitted for re-approval.`
  };
}
