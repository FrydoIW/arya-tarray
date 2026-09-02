import { currentBusinessMonthValue, formatBusinessDateTime } from "../../../lib/business-time.js";
import { HttpError } from "../../../lib/http.js";
import {
  loadEventCodeLabels,
  loadReportGeneratedBy,
  loadTransactionInquiryDetailRecord,
  loadTransactionInquiryReportRecords,
  loadTransactionInquiryWorkspaceRecords,
  type TransactionInquiryFilter
} from "./transaction-inquiry.repository.js";
import type { TransactionInquiryReportQuery, TransactionInquiryWorkspaceQuery } from "./transaction-inquiry.schema.js";
import { buildTransactionInquiryPdf } from "./transaction-inquiry.pdf.js";

const REPORT_LIMIT = 20000;

function monthRange(value: string) {
  const [yearRaw, monthRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  return {
    monthStart: new Date(Date.UTC(year, month - 1, 1)),
    nextMonthStart: new Date(Date.UTC(year, month, 1))
  };
}

function filterFromQuery(input: Pick<TransactionInquiryWorkspaceQuery, "month" | "search" | "status" | "bankAccountId">): TransactionInquiryFilter & { month: string } {
  const month = input.month ?? currentBusinessMonthValue();
  return {
    month,
    ...monthRange(month),
    search: input.search ?? "",
    status: input.status ?? "ALL",
    bankAccountId: input.bankAccountId
  };
}

function decimalToString(value: { toString(): string } | null | undefined) {
  return value?.toString() ?? "0.00";
}

function decimalToCents(value: { toString(): string } | string | null | undefined) {
  const raw = typeof value === "string" ? value : value?.toString() ?? "0";
  const negative = raw.startsWith("-");
  const normalized = negative ? raw.slice(1) : raw;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
  return negative ? -cents : cents;
}

function centsToDecimal(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

function absDecimal(value: { toString(): string } | null | undefined) {
  const cents = decimalToCents(value);
  return centsToDecimal(cents < 0n ? -cents : cents);
}

function statusLabel(value: string) {
  if (value === "RAW") return "Draft";
  if (value === "CHECK") return "Pending Approval";
  if (value === "FINALIZED") return "Complete";
  return value;
}

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function formatDate(value: Date | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(value);
}

function formatDateTime(value: Date) {
  return formatBusinessDateTime(value, "en-GB");
}

function formatIdr(value: string) {
  const cents = decimalToCents(value);
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}IDR ${whole}.${fraction}`;
}

function mapTransaction(item: Awaited<ReturnType<typeof loadTransactionInquiryWorkspaceRecords>>["transactions"][number]) {
  return {
    id: item.id,
    statementId: item.statementUpload.id,
    transactionDate: item.transactionDate,
    transactionType: item.transactionType,
    referenceNo: item.referenceNo,
    senderName: item.senderName,
    description: item.description,
    originalAmount: decimalToString(item.originalAmount),
    suffixCode: item.suffixCode,
    baseAmount: item.baseAmount ? decimalToString(item.baseAmount) : null,
    status: item.status,
    displayStatus: statusLabel(item.status),
    remark: item.remark,
    suggestedEvent: item.suggestedEventCode,
    finalEvent: item.eventCode,
    bankAccount: item.statementUpload.bankAccount
  };
}

export async function getTransactionInquiryWorkspace(input: TransactionInquiryWorkspaceQuery) {
  const filter = filterFromQuery(input);
  const records = await loadTransactionInquiryWorkspaceRecords({ filter, page: input.page, pageSize: input.pageSize });
  return {
    filters: {
      month: filter.month,
      search: filter.search,
      status: filter.status,
      bankAccountId: filter.bankAccountId ?? null
    },
    summary: {
      totalTransactions: records.total,
      totalCredit: decimalToString(records.totalCredit),
      totalDebit: absDecimal(records.totalDebit),
      completeTransactions: records.completeTransactions,
      incomingTransactions: records.incomingTransactions,
      outgoingTransactions: records.outgoingTransactions
    },
    bankAccounts: records.bankAccounts,
    transactions: records.transactions.map(mapTransaction),
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: records.total,
      totalPages: Math.max(1, Math.ceil(records.total / input.pageSize))
    }
  };
}

export async function getTransactionInquiryDetail(transactionId: string) {
  const transaction = await loadTransactionInquiryDetailRecord(transactionId);
  if (!transaction) throw new HttpError(404, "Transaction not found");

  const eventIds = [...new Set(transaction.history.flatMap((item) => [item.oldValue, item.newValue]).filter((value): value is string => Boolean(value && /^[0-9a-f-]{36}$/i.test(value))))];
  const eventCodes = await loadEventCodeLabels(eventIds);
  const eventLabels = new Map(eventCodes.map((item) => [item.id, `${item.code} - ${item.eventName}`]));

  return {
    statement: {
      id: transaction.statementUpload.id,
      fileName: transaction.statementUpload.fileName,
      periodFrom: transaction.statementUpload.periodFrom,
      periodTo: transaction.statementUpload.periodTo,
      status: transaction.statementUpload.status,
      displayStatus: statusLabel(transaction.statementUpload.status),
      bankAccount: transaction.statementUpload.bankAccount,
      uploadedBy: transaction.statementUpload.uploadedBy,
      executedBy: transaction.statementUpload.executedBy,
      finalizedBy: transaction.statementUpload.finalizedBy,
      approval: transaction.statementUpload.approval
    },
    transaction: {
      id: transaction.id,
      transactionDate: transaction.transactionDate,
      transactionType: transaction.transactionType,
      referenceNo: transaction.referenceNo,
      senderName: transaction.senderName,
      description: transaction.description,
      originalAmount: decimalToString(transaction.originalAmount),
      suffixCode: transaction.suffixCode,
      baseAmount: transaction.baseAmount ? decimalToString(transaction.baseAmount) : null,
      status: transaction.status,
      displayStatus: statusLabel(transaction.status),
      remark: transaction.remark,
      suggestedEvent: transaction.suggestedEventCode,
      finalEvent: transaction.eventCode
    },
    history: transaction.history.map((item) => ({
      id: item.id,
      fieldName: item.fieldName,
      oldValue: item.oldValue,
      newValue: item.newValue,
      oldValueLabel: item.fieldName === "event_code_id" && item.oldValue ? eventLabels.get(item.oldValue) ?? item.oldValue : item.oldValue,
      newValueLabel: item.fieldName === "event_code_id" && item.newValue ? eventLabels.get(item.newValue) ?? item.newValue : item.newValue,
      remark: item.remark,
      changedAt: item.changedAt,
      changedBy: item.changedBy
    }))
  };
}

export async function generateTransactionInquiryReport(input: TransactionInquiryReportQuery, userId: string) {
  const filter = filterFromQuery(input);
  const [records, generatedBy] = await Promise.all([
    loadTransactionInquiryReportRecords({ filter, limit: REPORT_LIMIT }),
    loadReportGeneratedBy(userId)
  ]);
  if (!generatedBy) throw new HttpError(401, "Current user is no longer available");
  if (records.count > REPORT_LIMIT || records.transactions.length > REPORT_LIMIT) {
    throw new HttpError(400, `Report contains more than ${REPORT_LIMIT.toLocaleString("en-US")} transactions. Narrow the filters and try again.`);
  }

  let totalCredit = 0n;
  let totalDebit = 0n;
  let incomingTransactions = 0;
  let outgoingTransactions = 0;
  let completeTransactions = 0;
  const classifications = new Map<string, { code: string; eventName: string; transactions: number; cents: bigint }>();

  for (const transaction of records.transactions) {
    const cents = decimalToCents(transaction.originalAmount);
    if (cents > 0n) {
      totalCredit += cents;
      incomingTransactions += 1;
      const event = transaction.eventCode;
      const key = event?.id ?? "NOT_APPLICABLE";
      const current = classifications.get(key) ?? {
        code: event?.code ?? "N/A",
        eventName: event?.eventName ?? "Non-classification / Unassigned",
        transactions: 0,
        cents: 0n
      };
      current.transactions += 1;
      current.cents += cents;
      classifications.set(key, current);
    } else if (cents < 0n) {
      totalDebit += -cents;
      outgoingTransactions += 1;
    }
    if (transaction.status === "FINALIZED") completeTransactions += 1;
  }

  const classificationRows = [...classifications.values()]
    .sort((a, b) => (a.cents === b.cents ? a.code.localeCompare(b.code) : a.cents > b.cents ? -1 : 1))
    .map((item) => ({
      code: item.code,
      eventName: item.eventName,
      transactions: item.transactions,
      amount: formatIdr(centsToDecimal(item.cents))
    }));
  classificationRows.push({
    code: "TOTAL",
    eventName: "All incoming classifications",
    transactions: incomingTransactions,
    amount: formatIdr(centsToDecimal(totalCredit))
  });

  const bankLabel = filter.bankAccountId
    ? records.bankAccounts[0]
      ? `${records.bankAccounts[0].bankCode} - ${records.bankAccounts[0].accountNo}`
      : "Selected bank account"
    : "All Bank Accounts";

  const pdf = buildTransactionInquiryPdf({
    periodLabel: monthLabel(filter.month),
    bankAccountLabel: bankLabel,
    statusLabel: filter.status === "ALL" ? "All Status" : statusLabel(filter.status),
    searchLabel: filter.search || null,
    generatedBy: generatedBy.fullName,
    generatedAt: formatDateTime(new Date()),
    summary: {
      totalTransactions: records.transactions.length,
      totalCredit: formatIdr(centsToDecimal(totalCredit)),
      totalDebit: formatIdr(centsToDecimal(totalDebit)),
      netMovement: formatIdr(centsToDecimal(totalCredit - totalDebit)),
      incomingTransactions,
      outgoingTransactions,
      completeTransactions
    },
    classifications: classificationRows,
    transactions: records.transactions.map((transaction) => ({
      date: formatDate(transaction.transactionDate),
      description: transaction.description ?? transaction.senderName ?? "-",
      referenceNo: transaction.referenceNo ?? "-",
      type: decimalToCents(transaction.originalAmount) >= 0n ? "Credit" : "Debit",
      amount: formatIdr(absDecimal(transaction.originalAmount)),
      finalEvent: transaction.eventCode ? `${transaction.eventCode.code} - ${transaction.eventCode.eventName}` : "N/A",
      status: statusLabel(transaction.status)
    })),
    includeFinancialSummary: input.includeFinancialSummary,
    includeClassificationSummary: input.includeClassificationSummary,
    includeTransactionDetail: input.includeTransactionDetail
  });

  return {
    buffer: pdf,
    fileName: `transaction-inquiry-${filter.month}.pdf`
  };
}
