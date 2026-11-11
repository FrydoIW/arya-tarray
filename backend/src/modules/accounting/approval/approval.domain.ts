import { createHash } from "node:crypto";
import { HttpError } from "../../../lib/http.js";

export type AccountingApprovalKind = "MANUAL_JOURNAL" | "ADJUSTING_JOURNAL" | "JOURNAL_REVERSAL"
  | "AP_INVOICE" | "AR_DOCUMENT" | "AR_ADJUSTMENT" | "SETTLEMENT" | "FUND_RELEASE"
  | "PERIOD_CLOSE" | "PERIOD_REOPEN" | "ACCRUAL_DOCUMENT" | "ACCRUAL_ADJUSTMENT"
  | "SCHEDULE_SETUP" | "SCHEDULE_CHANGE" | "SCHEDULE_CANCEL" | "SCHEDULE_TERMINATE" | "SCHEDULE_PERIOD"
  | "ASSET_ACTIVATE" | "ASSET_CHANGE" | "ASSET_JOURNAL" | "DEPRECIATION_RUN"
  | "FUND_SETUP" | "FUND_RESTRICTION" | "FUND_DESIGNATION" | "FUND_COMMAND" | "FUND_JOURNAL"
  | "REPORTING_POLICY" | "REPORT_SNAPSHOT" | "BANK_RECONCILIATION" | "YEAR_CLOSE" | "YEAR_REOPEN";
export type AccountingApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"
  | "SUPERSEDED" | "APPLIED";
export type AccountingApprovalDecision = "APPROVED" | "REJECTED";

export type AccountingApprovalEvidence = {
  id: string;
  kind: AccountingApprovalKind;
  sourceDocumentId: string;
  sourceVersion: number;
  sourceDigest: string;
  requestedById: string;
  status: AccountingApprovalStatus;
  decidedById: string | null;
  approverIds: readonly string[];
};

/** Accounting amounts and dates must be normalized to strings before hashing. */
function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  throw new HttpError(400, "Approval material must contain only explicit string, boolean, array or object values.");
}

export function accountingApprovalDigest(material: unknown): string {
  return createHash("sha256").update(canonical(material), "utf8").digest("hex");
}

export function assertAccountingApprovalDecision(input: {
  request: AccountingApprovalEvidence;
  actorId: string;
  hasPermission: boolean;
  currentDigest: string;
  decision: AccountingApprovalDecision;
}): void {
  const { request, actorId, hasPermission, currentDigest } = input;
  if (!hasPermission || !request.approverIds.includes(actorId)) {
    throw new HttpError(403, "User is not an authorized Accounting approver for this request.");
  }
  if (actorId === request.requestedById) {
    throw new HttpError(403, "Requester cannot approve or reject their own Accounting request.");
  }
  if (request.status !== "PENDING") throw new HttpError(409, "Accounting approval has already been decided or cancelled.");
  if (request.sourceDigest !== currentDigest) {
    throw new HttpError(409, "Accounting document changed after approval was requested; submit a new version.");
  }
}

export function decideAccountingApproval(input: Parameters<typeof assertAccountingApprovalDecision>[0] & {
  decidedAt: Date;
  remark: string | null;
}) {
  assertAccountingApprovalDecision(input);
  if (!Number.isFinite(input.decidedAt.getTime()) || (input.remark?.length ?? 0) > 1000) {
    throw new HttpError(400, "Accounting decision timestamp or remark is invalid.");
  }
  return {
    status: input.decision,
    decidedById: input.actorId,
    decidedAt: input.decidedAt,
    decisionRemark: input.remark,
    historyAction: input.decision === "APPROVED" ? "APPROVE" as const : "REJECT" as const,
    sourceDigest: input.request.sourceDigest
  };
}

export function assertAccountingApprovalForPosting(input: {
  request: AccountingApprovalEvidence;
  kind: AccountingApprovalKind;
  sourceDocumentId: string;
  sourceVersion: number;
  currentDigest: string;
  hasPostingPermission: boolean;
}): void {
  const { request } = input;
  if (!input.hasPostingPermission) throw new HttpError(403, "Accounting posting permission is required.");
  if (request.status !== "APPROVED" || !request.decidedById
    || request.decidedById === request.requestedById
    || !request.approverIds.includes(request.decidedById)) {
    throw new HttpError(409, "An independent, current Accounting approval is required before posting.");
  }
  if (request.kind !== input.kind || request.sourceDocumentId !== input.sourceDocumentId
    || request.sourceVersion !== input.sourceVersion || request.sourceDigest !== input.currentDigest) {
    throw new HttpError(409, "Accounting approval no longer matches this document version.");
  }
}
