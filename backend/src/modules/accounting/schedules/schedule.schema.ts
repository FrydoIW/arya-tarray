import { z } from "zod";
import { dateOnly } from "../period/period.schema.js";
import { exactPositiveAmount } from "../apar/apar.schema.js";
export const accrualMetadataSchema = z.object({ kind: z.enum(["ACCRUED_EXPENSE", "ACCRUED_INCOME"]),
  serviceStart: dateOnly, serviceEnd: dateOnly, supportingEvidence: z.string().trim().min(10).max(1000),
  policyReference: z.string().trim().min(10).max(1000), recognitionBasis: z.string().trim().min(10).max(1000),
  scheduledReversalOn: dateOnly.nullable().default(null) }).strict().refine(x => x.serviceStart <= x.serviceEnd, "Invalid service period");
export const accrualInputSchema = z.object({ sourceReference: z.string().trim().min(1).max(110), accountingDate: dateOnly,
  amount: exactPositiveAmount, recognitionAccountId: z.string().uuid(), balanceAccountId: z.string().uuid(),
  counterpartyId: z.string().uuid().nullable().default(null), metadata: accrualMetadataSchema }).strict();
export const accrualAdjustmentSchema = z.object({ sourceReference: z.string().trim().min(1).max(110), accountingDate: dateOnly,
  amount: exactPositiveAmount, adjustmentKind: z.enum(["INCREASE", "DECREASE"]), reason: z.string().trim().min(10).max(1000) }).strict();
export const planRowSchema = z.object({ accountingPeriodId: z.string().uuid(), recognitionDate: dateOnly, plannedAmount: exactPositiveAmount }).strict();
export const planInputSchema = z.object({ amount: exactPositiveAmount, startDate: dateOnly, endDate: dateOnly,
  allocationMethod: z.enum(["MONTHLY_EQUAL", "ACTUAL_DAYS", "CUSTOM"]), customPeriods: z.array(planRowSchema).max(240).optional() }).strict();
export const scheduleInputSchema = planInputSchema.extend({ scheduleReference: z.string().trim().min(1).max(100),
  scheduleKind: z.enum(["PREPAYMENT", "DEFERRED_INCOME"]), sourceJournalLineId: z.string().uuid(),
  recognitionAccountId: z.string().uuid(), policyEvidence: z.string().trim().min(10).max(1000),
  recognitionBasis: z.string().trim().min(10).max(1000) });
export const scheduleCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SETUP") }).strict(),
  z.object({ action: z.literal("CHANGE"), periods: z.array(planRowSchema).min(1).max(240), reason: z.string().trim().min(10).max(1000) }).strict(),
  z.object({ action: z.literal("CANCEL"), reason: z.string().trim().min(10).max(1000) }).strict(),
  z.object({ action: z.literal("TERMINATE"), accountingDate: dateOnly, reason: z.string().trim().min(10).max(1000) }).strict()
]);
export const scheduleRequestSchema = z.object({ expectedRevision: z.number().int().positive(), command: scheduleCommandSchema }).strict();
export const submitSchedulePeriodSchema = z.object({ expectedRevision: z.number().int().positive(), recognitionEvidence: z.string().trim().min(10).max(1000).optional() }).strict();
export const accrualUpdateSchema = accrualInputSchema.extend({ expectedRevision: z.number().int().positive() });
export type AccrualInput = z.infer<typeof accrualInputSchema>;
export type AccrualAdjustment = z.infer<typeof accrualAdjustmentSchema>;
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;
export type PlanInput = z.infer<typeof planInputSchema>;
export type PlanRow = z.infer<typeof planRowSchema>;
export type ScheduleCommand = z.infer<typeof scheduleCommandSchema>;
