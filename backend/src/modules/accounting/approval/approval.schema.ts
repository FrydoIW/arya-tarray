import { z } from "zod";
import { dateOnly } from "../period/period.schema.js";
import { adjustmentInputSchema } from "../apar/apar.schema.js";
import { scheduleCommandSchema } from "../schedules/schedule.schema.js";
import { fundApprovalSchema } from "../funds/fund.schema.js";
import { finalApprovalSchema } from "../finalization/finalization.schema.js";

export const approvalKindSchema = z.enum(["MANUAL_JOURNAL", "ADJUSTING_JOURNAL", "JOURNAL_REVERSAL",
  "AP_INVOICE", "AR_DOCUMENT", "AR_ADJUSTMENT", "SETTLEMENT", "FUND_RELEASE", "PERIOD_CLOSE", "PERIOD_REOPEN",
  "ACCRUAL_DOCUMENT", "ACCRUAL_ADJUSTMENT", "SCHEDULE_SETUP", "SCHEDULE_CHANGE", "SCHEDULE_CANCEL", "SCHEDULE_TERMINATE", "SCHEDULE_PERIOD",
  "ASSET_ACTIVATE", "ASSET_CHANGE", "ASSET_JOURNAL", "DEPRECIATION_RUN", "FUND_SETUP", "FUND_RESTRICTION", "FUND_DESIGNATION", "FUND_COMMAND", "FUND_JOURNAL", "REPORTING_POLICY", "REPORT_SNAPSHOT", "BANK_RECONCILIATION", "YEAR_CLOSE", "YEAR_REOPEN"]);
export const approvalStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED", "SUPERSEDED", "APPLIED"]);
const dimension = z.string().uuid().nullable().optional();
const amount = z.string().regex(/^\d{1,18}(\.\d{1,2})?$/);
export const draftInputSchema = z.object({
  journalType: z.enum(["MANUAL", "ADJUSTMENT"]),
  accountingDate: dateOnly,
  sourceReference: z.string().trim().min(1).max(110),
  description: z.string().trim().max(5000).nullable().default(null),
  lines: z.array(z.object({ accountId: z.string().uuid(), debit: amount, credit: amount,
    bankAccountId: dimension, accountingFundId: dimension, fundRestrictionId: dimension,
    counterpartyId: dimension }).strict()).min(2).max(500)
}).strict();
export const updateDraftSchema = draftInputSchema.extend({ expectedRevision: z.number().int().positive() });
export const approvalRequestSchema = z.discriminatedUnion("kind", [
  finalApprovalSchema,
  fundApprovalSchema,
  z.object({ kind: z.enum(["ASSET_ACTIVATE", "ASSET_CHANGE", "ASSET_JOURNAL", "DEPRECIATION_RUN"]), sourceDocumentId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ kind: z.enum(["ACCRUAL_DOCUMENT", "ACCRUAL_ADJUSTMENT", "SCHEDULE_PERIOD", "SCHEDULE_SETUP", "SCHEDULE_CHANGE", "SCHEDULE_CANCEL", "SCHEDULE_TERMINATE"]),
    sourceDocumentId: z.string().uuid(), expectedRevision: z.number().int().positive(), command: scheduleCommandSchema.optional(),
    recognitionEvidence: z.string().trim().min(10).max(1000).optional() }).strict(),
  z.object({ kind: z.literal("MANUAL_JOURNAL"), sourceDocumentId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("ADJUSTING_JOURNAL"), sourceDocumentId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("AP_INVOICE"), sourceDocumentId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("AR_DOCUMENT"), sourceDocumentId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("SETTLEMENT"), sourceDocumentId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict(),
  adjustmentInputSchema.extend({ kind: z.literal("AR_ADJUSTMENT"), sourceDocumentId: z.string().uuid() }),
  z.object({ kind: z.literal("JOURNAL_REVERSAL"), sourceDocumentId: z.string().uuid(), accountingDate: dateOnly,
    remark: z.string().trim().min(1).max(1000) }).strict()
]);
export const approvalDecisionSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]),
  remark: z.string().trim().max(1000).nullable().default(null) }).strict();
export const cancellationSchema = z.object({ remark: z.string().trim().min(1).max(1000) }).strict();
export const approvalSettingsSchema = z.object({ activeFlag: z.boolean(),
  approverUserIds: z.array(z.string().uuid()).max(100).refine(ids => new Set(ids).size === ids.length, "Duplicate approver")
}).strict().refine(value => !value.activeFlag || value.approverUserIds.length > 0, "Active approval requires an approver");
export const approvalListSchema = z.object({ status: approvalStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
export type DraftInput = z.infer<typeof draftInputSchema>;
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;
export type ApprovalRequestInput = z.infer<typeof approvalRequestSchema>;

