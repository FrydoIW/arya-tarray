import type { Prisma } from "@prisma/client";
import { dateOnly } from "../period/period.schema.js";

const periodDates = { id: true, startDate: true, endDate: true } as const;
const sourceSelect = {
  id: true, requestKind: true, sourceDocumentId: true, status: true, requestPayload: true,
  journalDraft: { select: { id: true, sourceKind: true, accountingDate: true } },
  document: { select: { id: true, documentKind: true, accountingDate: true } },
  settlement: { select: { id: true, settlementDate: true } },
  originalJournal: { select: { id: true } },
  period: { select: periodDates },
  final26_fiscalYearId: { select: periodDates },
  schedule: { select: { id: true, startDate: true } },
  schedulePeriod: { select: { id: true, recognitionDate: true, relFkAccSchedulePeriodPeriod: { select: periodDates } } },
  fixedAsset: { select: { id: true, relFkAccFixedAssetSource: { select: { journal: { select: { accountingDate: true } } } } } },
  depreciationRun: { select: { id: true, runDate: true, relFkAccDepRunPeriod: { select: periodDates } } },
  fund25_accountingFundId: { select: { id: true, effectiveOn: true } },
  restriction: { select: { id: true, effectiveOn: true, fund25_sourceJournalLineId: { select: { journal: { select: { accountingDate: true } } } } } },
  fund25_fundDesignationId: { select: { id: true, effectiveOn: true } },
  final26_bankReconciliationId: { select: { id: true, reconciliationDate: true, relFkAccBankReconPeriod: { select: periodDates } } }
} satisfies Prisma.AccountingApprovalRequestSelect;
export type ClosingApprovalSource = Prisma.AccountingApprovalRequestGetPayload<{ select: typeof sourceSelect }>;
function object(value: Prisma.JsonValue | undefined) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function day(value: unknown): string | null {
  const text = value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : value;
  const parsed = dateOnly.safeParse(text); return parsed.success ? parsed.data : null;
}
function datedPeriod(value: unknown, period: { startDate: Date; endDate: Date }) {
  const date = day(value), start = day(period.startDate), end = day(period.endDate);
  return date && start && end && start <= date && date <= end ? date : null;
}
/** Dates mirror each existing source adapter; requestedAt is deliberately not selected. */
export function closingApprovalDate(r: ClosingApprovalSource): string | null {
  const same = (source: { id: string } | null) => source?.id === r.sourceDocumentId;
  const payload = object(r.requestPayload), command = object(payload?.command), release = object(payload?.release);
  switch (r.requestKind) {
    case "MANUAL_JOURNAL": case "ADJUSTING_JOURNAL": case "ACCRUAL_DOCUMENT": case "ACCRUAL_ADJUSTMENT":
    case "ASSET_CHANGE": case "ASSET_JOURNAL": case "FUND_COMMAND": case "FUND_JOURNAL":
    case "REPORTING_POLICY": case "REPORT_SNAPSHOT":
      return same(r.journalDraft) && r.journalDraft?.sourceKind === r.requestKind ? day(r.journalDraft.accountingDate) : null;
    case "AP_INVOICE": return same(r.document) && r.document?.documentKind === "PAYABLE" ? day(r.document.accountingDate) : null;
    case "AR_DOCUMENT": return same(r.document) && r.document?.documentKind === "RECEIVABLE" ? day(r.document.accountingDate) : null;
    case "AR_ADJUSTMENT": return same(r.document) && r.document?.documentKind === "RECEIVABLE" ? day(payload?.accountingDate) : null;
    case "SETTLEMENT": return same(r.settlement) ? day(r.settlement?.settlementDate) : null;
    case "JOURNAL_REVERSAL": return same(r.originalJournal) ? day(payload?.accountingDate) : null;
    case "PERIOD_CLOSE": case "PERIOD_REOPEN": return same(r.period) ? day(r.period?.endDate) : null;
    case "YEAR_CLOSE": case "YEAR_REOPEN": return same(r.final26_fiscalYearId) ? day(r.final26_fiscalYearId?.endDate) : null;
    case "SCHEDULE_SETUP": case "SCHEDULE_CHANGE": case "SCHEDULE_CANCEL":
      return same(r.schedule) && command?.action === r.requestKind.slice(9) ? day(r.schedule?.startDate) : null;
    case "SCHEDULE_TERMINATE": return same(r.schedule) && command?.action === "TERMINATE" ? day(command.accountingDate) : null;
    case "SCHEDULE_PERIOD": return same(r.schedulePeriod) && r.schedulePeriod ? datedPeriod(r.schedulePeriod.recognitionDate, r.schedulePeriod.relFkAccSchedulePeriodPeriod) : null;
    case "ASSET_ACTIVATE": return same(r.fixedAsset) ? day(r.fixedAsset?.relFkAccFixedAssetSource.journal.accountingDate) : null;
    case "DEPRECIATION_RUN": return same(r.depreciationRun) && r.depreciationRun ? datedPeriod(r.depreciationRun.runDate, r.depreciationRun.relFkAccDepRunPeriod) : null;
    case "FUND_SETUP": return same(r.fund25_accountingFundId) ? day(r.fund25_accountingFundId?.effectiveOn) : null;
    case "FUND_RESTRICTION": return same(r.restriction) ? day(r.restriction?.effectiveOn ?? r.restriction?.fund25_sourceJournalLineId.journal.accountingDate) : null;
    case "FUND_RELEASE": return same(r.restriction) ? day(release?.accountingDate) : null;
    case "FUND_DESIGNATION": return same(r.fund25_fundDesignationId) ? day(r.fund25_fundDesignationId?.effectiveOn) : null;
    case "BANK_RECONCILIATION": return same(r.final26_bankReconciliationId) && r.final26_bankReconciliationId ? datedPeriod(r.final26_bankReconciliationId.reconciliationDate, r.final26_bankReconciliationId.relFkAccBankReconPeriod) : null;
    default: return null;
  }
}
export async function pendingClosingApprovals(tx: Prisma.TransactionClient, input: { type: "PERIOD" | "YEAR"; id: string; from: string; to: string }) {
  const result = { count: 0, inPeriod: 0, priorPeriod: 0, unknownPeriod: 0,
    cutoffRule: "ALL_UNRESOLVED_THROUGH_CUTOFF_BLOCK; UNKNOWN_DATE_BLOCKS; FUTURE_DATE_EXCLUDED",
    exceptions: [] as { requestId: string; requestKind: string; sourceId: string; status: string; accountingDate: string | null; reason: string }[], exceptionsTruncated: false };
  let cursor: string | undefined;
  for (;;) {
    // Prisma batches each selected FK relation; there is no per-request source lookup.
    const rows: ClosingApprovalSource[] = await tx.accountingApprovalRequest.findMany({ where: {
      status: { in: ["PENDING", "APPROVED"] }, id: cursor ? { gt: cursor } : undefined,
      NOT: { requestKind: input.type === "PERIOD" ? "PERIOD_CLOSE" : "YEAR_CLOSE", sourceDocumentId: input.id }
    }, select: sourceSelect, orderBy: { id: "asc" }, take: 200 });
    for (const r of rows) {
      const date = closingApprovalDate(r);
      // Irrelevant future requests do not enter the snapshot/digest, even as diagnostic counts.
      if (date && date > input.to) continue;
      const reason = !date ? "UNKNOWN_SOURCE_ACCOUNTING_DATE" : date < input.from ? "UNRESOLVED_PRIOR_PERIOD_APPROVAL" : "UNRESOLVED_IN_PERIOD_APPROVAL";
      result.count++; if (!date) result.unknownPeriod++; else if (date < input.from) result.priorPeriod++; else result.inPeriod++;
      if (result.exceptions.length < 100) result.exceptions.push({ requestId: r.id, requestKind: r.requestKind, sourceId: r.sourceDocumentId, status: r.status, accountingDate: date, reason });
      else result.exceptionsTruncated = true;
    }
    if (rows.length < 200) return result;
    cursor = rows.at(-1)?.id;
  }
}
