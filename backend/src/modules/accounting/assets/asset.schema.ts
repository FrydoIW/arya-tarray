import { z } from "zod";
import { dateOnly } from "../period/period.schema.js";
import { exactPositiveAmount } from "../apar/apar.schema.js";
import { accountingCents } from "../accounting.domain.js";
export const nonnegativeAmount = z.string().regex(/^\d{1,18}(\.\d{1,2})?$/).refine(v => { try { return accountingCents(v) >= 0n; } catch { return false; } });
const nullableId = z.string().uuid().nullable().default(null);
export const assetPolicySchema = z.object({ policyReference: z.string().trim().min(10).max(1000), capitalizationThreshold: nonnegativeAmount,
  partialMonthPolicy: z.enum(["FULL_MONTH", "NEXT_MONTH", "ACTUAL_DAYS"]), impairmentEnabled: z.boolean(), impairmentPolicyReference: z.string().trim().min(10).max(1000).nullable() }).strict();
export const categorySchema = z.object({ categoryCode: z.string().trim().min(1).max(40), categoryName: z.string().trim().min(1).max(150),
  assetAccountId: z.string().uuid(), accumulatedDepreciationAccountId: z.string().uuid(), depreciationExpenseAccountId: z.string().uuid(),
  gainAccountId: nullableId, lossAccountId: nullableId, impairmentExpenseAccountId: nullableId, impairmentAllowanceAccountId: nullableId,
  disposalClearingAccountId: nullableId, defaultUsefulLifeMonths: z.number().int().min(1).max(600), defaultMethod: z.literal("STRAIGHT_LINE").default("STRAIGHT_LINE"),
  activeFlag: z.boolean().default(true), policy: assetPolicySchema.nullable().default(null) }).strict();
export const assetInputSchema = z.object({ assetNumber: z.string().trim().min(1).max(80), assetName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().default(null), location: z.string().trim().max(255).nullable().default(null),
  assetCategoryId: z.string().uuid(), acquisitionJournalLineId: z.string().uuid(), acquiredOn: dateOnly, inServiceOn: dateOnly,
  depreciationStartOn: dateOnly, usefulLifeMonths: z.number().int().min(1).max(600), residualValue: nonnegativeAmount,
  custodianId: nullableId, supportingEvidence: z.string().trim().min(10).max(1000) }).strict();
const common = { effectiveDate: dateOnly, reason: z.string().trim().min(10).max(1000) };
export const assetChangeSchema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("ESTIMATE"), remainingLifeMonths: z.number().int().min(1).max(600), residualValue: nonnegativeAmount }).strict(),
  z.object({ ...common, action: z.literal("ADDITIONAL"), sourceJournalLineId: z.string().uuid(), remainingLifeMonths: z.number().int().min(1).max(600), residualValue: nonnegativeAmount }).strict(),
  z.object({ ...common, action: z.literal("CORRECTION"), assetName: z.string().trim().min(1).max(200).optional(), description: z.string().max(1000).nullable().optional(),
    location: z.string().max(255).nullable().optional(), custodianId: z.string().uuid().nullable().optional(), acquiredOn: dateOnly.optional() }).strict(),
  z.object({ ...common, action: z.literal("RECLASSIFY"), categoryId: z.string().uuid() }).strict(),
  z.object({ ...common, action: z.literal("IMPAIRMENT"), recoverableAmount: nonnegativeAmount, residualValue: nonnegativeAmount,
    remainingLifeMonths: z.number().int().min(1).max(600), assessmentEvidence: z.string().trim().min(10).max(1000) }).strict(),
  z.object({ ...common, action: z.literal("IMPAIRMENT_REVERSAL"), assessmentEvidence: z.string().trim().min(10).max(1000) }).strict(),
  z.object({ ...common, action: z.literal("DISPOSE"), proceeds: nonnegativeAmount, considerationJournalLineId: nullableId, costJournalLineId: nullableId }).strict(),
  z.object({ ...common, action: z.literal("WRITE_OFF") }).strict(),
  z.object({ ...common, action: z.literal("DEACTIVATE") }).strict()
]);
export const runInputSchema = z.object({ runReference: z.string().trim().min(1).max(100), accountingPeriodId: z.string().uuid(),
  assetIds: z.array(z.string().uuid()).min(1).max(200).refine(ids => new Set(ids).size === ids.length) }).strict();
export type AssetInput = z.infer<typeof assetInputSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type AssetChange = z.infer<typeof assetChangeSchema>;
export type AssetPolicy = z.infer<typeof assetPolicySchema>;
export type RunInput = z.infer<typeof runInputSchema>;
