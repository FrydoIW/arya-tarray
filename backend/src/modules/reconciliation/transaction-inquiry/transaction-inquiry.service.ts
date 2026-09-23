import { currentBusinessDayValue, currentBusinessMonthValue, formatBusinessDateTime } from "../../../lib/business-time.js";
import { HttpError } from "../../../lib/http.js";
import { formatPeriodLabel, resolvePeriod } from "../../../lib/period.js";
import {
  loadEventCodeLabels,
  loadReportGeneratedBy,
  loadTransactionInquiryEventOption,
  loadTransactionInquiryCampaignOption,
  loadCampaignLabels,
  loadTransactionInquiryMemberOption,
  loadTransactionInquiryMemberOptions,
  loadTransactionInquiryDetailRecord,
  loadTimeBasedCarryAfterPayment,
  loadTransactionInquiryReportRecords,
  loadTransactionInquiryWorkspaceRecords,
  type TransactionInquiryFilter
} from "./transaction-inquiry.repository.js";
import type { TransactionInquiryMemberOptionsQuery, TransactionInquiryReportQuery, TransactionInquiryWorkspaceQuery } from "./transaction-inquiry.schema.js";
import { buildTransactionInquiryPdf } from "./transaction-inquiry.pdf.js";
import { resolveCanonicalTransactionMember } from "./transaction-inquiry-member.domain.js";
import { resolveTimeBasedUnits } from "../time-based-classification.js";

const REPORT_LIMIT = 20000;

type TransactionInquiryFilterQuery = Pick<TransactionInquiryWorkspaceQuery, "periodMode" | "month" | "date" | "search" | "status" | "bankAccountId" | "finalEventId" | "eventCampaignId" | "memberId" | "memberLinkStatus">;

function filterFromQuery(input: TransactionInquiryFilterQuery): TransactionInquiryFilter & { periodMode: "MONTH" | "DAY"; month: string; date: string } {
  const periodMode = input.periodMode ?? "MONTH";
  const month = input.month ?? currentBusinessMonthValue();
  const date = input.date ?? (periodMode === "MONTH" ? `${month}-01` : currentBusinessDayValue());
  const period = resolvePeriod(periodMode, month, date);
  return {
    periodMode,
    month: period.month,
    date: period.date,
    periodStart: period.start,
    periodEnd: period.end,
    search: input.search ?? "",
    status: input.status ?? "ALL",
    bankAccountId: input.bankAccountId,
    finalEventId: input.finalEventId,
    eventCampaignId: input.eventCampaignId,
    memberId: input.memberId,
    memberLinkStatus: input.memberLinkStatus ?? "ALL"
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

export function formatIdr(value: string) {
  const cents = decimalToCents(value);
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraction = (absolute % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}Rp${whole}${fraction ? `,${fraction}` : ""}`;
}

function mapTransaction(item: Awaited<ReturnType<typeof loadTransactionInquiryWorkspaceRecords>>["transactions"][number]) {
  const member = resolveCanonicalTransactionMember(item.memberIdentity);
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
    sourceType: item.sourceType,
    correctionReason: item.correctionReason,
    manualAddedAt: item.manualAddedAt,
    suggestedEvent: item.suggestedEventCode,
    finalEvent: item.eventCode,
    eventCampaign: item.eventCampaign,
    memberIdentity: item.memberIdentity ? {
      id: item.memberIdentity.id,
      accountName: item.memberIdentity.accountName,
      verificationStatus: item.memberIdentity.verificationStatus
    } : null,
    member: member ? {
      memberId: member.id,
      memberCode: member.memberCode,
      memberName: member.memberName,
      memberInitialName: member.initialName,
      activeFlag: member.activeFlag
    } : null,
    bankAccount: item.statementUpload.bankAccount
  };
}

export async function getTransactionInquiryWorkspace(input: TransactionInquiryWorkspaceQuery) {
  const filter = filterFromQuery(input);
  const records = await loadTransactionInquiryWorkspaceRecords({ filter, page: input.page, pageSize: input.pageSize });
  return {
    filters: {
      periodMode: filter.periodMode,
      month: filter.month,
      date: filter.date,
      search: filter.search,
      status: filter.status,
      bankAccountId: filter.bankAccountId ?? null,
      finalEventId: filter.finalEventId ?? null,
      eventCampaignId: filter.eventCampaignId ?? null,
      memberId: filter.memberId ?? null,
      memberLinkStatus: filter.memberLinkStatus
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
    eventOptions: records.eventOptions,
    campaignOptions: records.campaignOptions,
    transactions: records.transactions.map(mapTransaction),
    pagination: {
      page: records.page,
      pageSize: input.pageSize,
      total: records.total,
      totalPages: Math.max(1, Math.ceil(records.total / input.pageSize))
    }
  };
}

export async function getTransactionInquiryDetail(transactionId: string) {
  const transaction = await loadTransactionInquiryDetailRecord(transactionId);
  if (!transaction) throw new HttpError(404, "Transaction not found");

  const eventIds = [...new Set(transaction.history.filter((item) => item.fieldName === "event_code_id").flatMap((item) => [item.oldValue, item.newValue]).filter((value): value is string => Boolean(value && /^[0-9a-f-]{36}$/i.test(value))))];
  const eventCodes = await loadEventCodeLabels(eventIds);
  const eventLabels = new Map(eventCodes.map((item) => [item.id, `${item.code} - ${item.eventName}`]));
  const campaignIds = [...new Set(transaction.history.filter((item) => item.fieldName === "event_campaign_id").flatMap((item) => [item.oldValue, item.newValue]).filter((value): value is string => Boolean(value)))];
  const campaignLabels = new Map((await loadCampaignLabels(campaignIds)).map((item) => [item.id, item.campaignName]));
  const member = resolveCanonicalTransactionMember(transaction.memberIdentity);
  let sponsorship: { unitAmount: string; durationMonths: number; grantedMonths: number; principalAmount: string; paymentCredited: string | null; paymentOnlyRemainder: string; carryBalanceAfterPayment: string | null; allocation: { referenceNo: string | null; displayName: string | null; coverageFrom: Date | null; coverageTo: Date | null } | null } | null = null;
  const relevantPayments = transaction.memberEventBalanceLedger.filter(row => row.subscription.memberId === member?.id
    && row.subscription.eventCodeId === transaction.eventCodeId);
  const originalCents = decimalToCents(transaction.originalAmount);
  const legacyCents = transaction.baseAmount ? decimalToCents(transaction.baseAmount) : null;
  const matchingPayments = (amount: bigint | null) => amount === null ? []
    : relevantPayments.filter(row => decimalToCents(row.amountDelta) === amount);
  const hasRateSnapshot = (row: typeof relevantPayments[number]) => Boolean(row.unitAmountSnapshot && row.durationMonthsSnapshot);
  const fullPaymentRows = matchingPayments(originalCents);
  const legacyPaymentRows = legacyCents !== null && legacyCents !== originalCents ? matchingPayments(legacyCents) : [];
  const currentPayment = fullPaymentRows.find(row => row.entryStatus === "ACTIVE")
    ?? legacyPaymentRows.find(row => row.entryStatus === "ACTIVE") ?? null;
  const historicalPayment = fullPaymentRows.find(hasRateSnapshot) ?? legacyPaymentRows.find(hasRateSnapshot) ?? null;
  const selectedPayment = currentPayment ?? historicalPayment;
  const coverage = transaction.memberEventCoverages.find(item => item.subscription.memberId === member?.id
    && (!selectedPayment || item.subscription.id === selectedPayment.subscription.id)) ?? null;
  const carryAfterPayment = currentPayment && transaction.transactionDate
    ? await loadTimeBasedCarryAfterPayment(currentPayment.subscription.id, transaction.transactionDate, transaction.id) : null;
  try {
    const rule = currentPayment?.unitAmountSnapshot && currentPayment.durationMonthsSnapshot ? {
      unitAmount: currentPayment.unitAmountSnapshot.toString(), durationMonths: currentPayment.durationMonthsSnapshot
    } : historicalPayment?.unitAmountSnapshot && historicalPayment.durationMonthsSnapshot ? {
      unitAmount: historicalPayment.unitAmountSnapshot.toString(), durationMonths: historicalPayment.durationMonthsSnapshot
    } : coverage?.unitAmountSnapshot && coverage.durationMonthsSnapshot ? {
      unitAmount: coverage.unitAmountSnapshot.toString(), durationMonths: coverage.durationMonthsSnapshot
    } : null;
    const resolved = rule ?? resolveTimeBasedUnits({ eventCode: transaction.eventCode,
      rule: transaction.eventCode?.timeRule ?? null, transaction, requiresClassification: true });
    if (resolved) {
      const principal = originalCents;
      const unit = decimalToCents(resolved.unitAmount);
      sponsorship = {
        unitAmount: resolved.unitAmount, durationMonths: resolved.durationMonths,
        grantedMonths: coverage?.grantedUnits && coverage.durationMonthsSnapshot
          ? coverage.grantedUnits * coverage.durationMonthsSnapshot : currentPayment ? 0 : Number(principal / unit) * resolved.durationMonths,
        principalAmount: centsToDecimal(principal), paymentCredited: currentPayment?.amountDelta.toString() ?? null,
        paymentOnlyRemainder: centsToDecimal(principal % unit),
        carryBalanceAfterPayment: carryAfterPayment?.toString() ?? null,
        allocation: currentPayment ? { referenceNo: currentPayment.subscription.referenceNo,
          displayName: currentPayment.subscription.displayName, coverageFrom: coverage?.coverageFrom ?? null,
          coverageTo: coverage?.coverageTo ?? null } : null
      };
    }
  } catch { sponsorship = null; }

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
      sourceType: transaction.sourceType,
      correctionReason: transaction.correctionReason,
      manualAddedAt: transaction.manualAddedAt,
      manualAddedBy: transaction.manualAddedBy,
      reconciliationExcludedAt: transaction.reconciliationExcludedAt,
      reconciliationExcludedBy: transaction.reconciliationExcludedBy,
      reconciliationExclusionReason: transaction.reconciliationExclusionReason,
      suggestedEvent: transaction.suggestedEventCode,
      finalEvent: transaction.eventCode,
      eventCampaign: transaction.eventCampaign,
      memberIdentity: transaction.memberIdentity ? {
        id: transaction.memberIdentity.id,
        accountName: transaction.memberIdentity.accountName,
        verificationStatus: transaction.memberIdentity.verificationStatus
      } : null,
      member: member ? {
        memberId: member.id,
        memberCode: member.memberCode,
        memberName: member.memberName,
        memberInitialName: member.initialName,
        activeFlag: member.activeFlag
      } : null,
      sponsorship
    },
    history: transaction.history.map((item) => ({
      id: item.id,
      fieldName: item.fieldName,
      oldValue: item.oldValue,
      newValue: item.newValue,
      oldValueLabel: item.oldValue ? (item.fieldName === "event_code_id" ? eventLabels.get(item.oldValue) : item.fieldName === "event_campaign_id" ? campaignLabels.get(item.oldValue) : null) ?? item.oldValue : item.oldValue,
      newValueLabel: item.newValue ? (item.fieldName === "event_code_id" ? eventLabels.get(item.newValue) : item.fieldName === "event_campaign_id" ? campaignLabels.get(item.newValue) : null) ?? item.newValue : item.newValue,
      remark: item.remark,
      changedAt: item.changedAt,
      changedBy: item.changedBy
    }))
  };
}

export async function generateTransactionInquiryReport(input: TransactionInquiryReportQuery, userId: string) {
  const filter = filterFromQuery(input);
  const [records, generatedBy, selectedEvent, selectedCampaign, selectedMember] = await Promise.all([
    loadTransactionInquiryReportRecords({ filter, limit: REPORT_LIMIT }),
    loadReportGeneratedBy(userId),
    filter.finalEventId ? loadTransactionInquiryEventOption(filter.finalEventId) : Promise.resolve(null),
    filter.eventCampaignId ? loadTransactionInquiryCampaignOption(filter.eventCampaignId) : Promise.resolve(null),
    filter.memberId ? loadTransactionInquiryMemberOption(filter.memberId) : Promise.resolve(null)
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
    periodLabel: formatPeriodLabel({ mode: filter.periodMode, month: filter.month, date: filter.date }),
    bankAccountLabel: bankLabel,
    statusLabel: filter.status === "ALL" ? "All Status" : statusLabel(filter.status),
    finalEventLabel: selectedEvent ? `${selectedEvent.code} - ${selectedEvent.eventName}` : "All Final Events",
    campaignLabel: selectedCampaign?.campaignName ?? (filter.eventCampaignId ? "Selected Campaign" : "All Campaigns"),
    memberLabel: selectedMember
      ? `${selectedMember.memberCode} - ${selectedMember.memberName}${selectedMember.activeFlag ? "" : " (Inactive)"}`
      : filter.memberId ? "Selected Member" : "All Members",
    memberLinkStatusLabel: filter.memberLinkStatus === "LINKED" ? "Linked" : filter.memberLinkStatus === "UNLINKED" ? "Unlinked" : "All",
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
    transactions: records.transactions.map((transaction) => {
      const member = resolveCanonicalTransactionMember(transaction.memberIdentity);
      return {
        date: formatDate(transaction.transactionDate),
        description: `${transaction.sourceType === "MANUAL" ? "[MANUAL] " : ""}${transaction.description ?? transaction.senderName ?? "-"}`,
        referenceNo: transaction.referenceNo ?? "-",
        type: decimalToCents(transaction.originalAmount) >= 0n ? "Incoming" : "Outgoing",
        amount: formatIdr(absDecimal(transaction.originalAmount)),
        finalEvent: decimalToCents(transaction.originalAmount) < 0n
          ? "Outgoing"
          : transaction.eventCode ? `${transaction.eventCode.code} - ${transaction.eventCode.eventName}` : "N/A",
        campaign: transaction.eventCampaign?.campaignName ?? "—",
        member: member ? `${member.memberCode} - ${member.memberName}${member.activeFlag ? "" : " (Inactive)"}` : "Belum Terhubung",
        status: statusLabel(transaction.status)
      };
    }),
    includeFinancialSummary: input.includeFinancialSummary,
    includeClassificationSummary: input.includeClassificationSummary,
    includeTransactionDetail: input.includeTransactionDetail
  });

  return {
    buffer: pdf,
    fileName: `transaction-inquiry-${filter.periodMode === "DAY" ? filter.date : filter.month}.pdf`
  };
}

export async function getTransactionInquiryMemberOptions(input: TransactionInquiryMemberOptionsQuery) {
  const members = await loadTransactionInquiryMemberOptions(input.search, input.limit);
  return {
    members: members.map(member => ({
      memberId: member.id,
      memberCode: member.memberCode,
      memberName: member.memberName,
      memberInitialName: member.initialName,
      activeFlag: member.activeFlag
    }))
  };
}
