import { z } from "zod";
import { dateOnly } from "../period/period.schema.js";
import { exactPositiveAmount } from "../apar/apar.schema.js";
const id = z.string().uuid(), nullableId = id.nullable().default(null);
const evidence = z.string().trim().min(10).max(1000);
export const fundPolicySchema = z.object({ policyReference: evidence,
  contributionAccountId: id, conditionalObligationEvidence: evidence.nullable().default(null),
  release: z.object({ mode: z.enum(["REVENUE_RECLASSIFICATION", "NET_ASSET_RECLASSIFICATION"]), debitAccountId: id, creditAccountId: id }).strict().nullable().default(null)
}).strict();
export const fundInputSchema = z.object({ fundCode: z.string().trim().min(1).max(40), fundName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().default(null), fundClass: z.enum(["UNRESTRICTED", "DONOR_RESTRICTED", "CONDITIONAL_LIABILITY", "CONDITIONAL_REVIEW"]),
  balanceAccountId: nullableId, eventCampaignId: nullableId, effectiveOn: dateOnly, expiresOn: dateOnly.nullable().default(null),
  sourceReference: z.string().trim().min(1).max(255), policy: fundPolicySchema.nullable().default(null)
}).strict();
export const criteriaSchema = z.object({ purposeCriterion: z.enum(["EXPENSE_INCURRED", "CAPITAL_ACQUIRED", "MILESTONE", "TIME_ONLY"]),
  eligibilityTerms: evidence, termsEffectiveOn: dateOnly.optional() }).strict();
export const restrictionInputSchema = z.object({ sourceJournalLineId: id, originalAmount: exactPositiveAmount, donorMemberId: nullableId,
  restrictionKind: z.enum(["PURPOSE", "TIME", "BOTH"]), purposeText: evidence.nullable().default(null), effectiveOn: dateOnly, releaseOn: dateOnly.nullable().default(null),
  supportingReference: z.string().trim().min(1).max(255), termsEvidence: evidence, criteria: criteriaSchema, eventCampaignId: nullableId }).strict();
export const designationInputSchema = z.object({ designationReference: z.string().trim().min(1).max(100), purposeText: evidence,
  amount: exactPositiveAmount, effectiveOn: dateOnly }).strict();
export const fundMovementSchema = z.object({ action: z.enum(["CLASSIFY", "OPENING"]), sourceJournalLineId: id, amount: exactPositiveAmount,
  accountingDate: dateOnly, sourceReference: z.string().trim().min(1).max(110), reason: evidence }).strict();
export const releaseInputSchema = z.object({ amount: exactPositiveAmount, releaseReference: z.string().trim().min(1).max(100),
  accountingDate: dateOnly, satisfactionDate: dateOnly, targetFundId: id, releaseReason: z.string().trim().min(10).max(500),
  eligibilityEvidence: evidence, evidenceReference: z.string().trim().min(1).max(255), evidenceJournalLineId: nullableId }).strict();
const common = { accountingDate: dateOnly, sourceReference: z.string().trim().min(1).max(110), reason: evidence };
export const fundCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("CLOSE") }).strict(),
  z.object({ ...common, action: z.literal("REOPEN") }).strict(),
  z.object({ ...common, action: z.literal("AMEND_TERMS"), restrictionId: id, purposeText: evidence.nullable(), releaseOn: dateOnly.nullable(), termsEvidence: evidence, criteria: criteriaSchema }).strict(),
  z.object({ ...common, action: z.literal("DESIGNATION_ADJUST"), designationId: id, amount: exactPositiveAmount, purposeText: evidence }).strict(),
  z.object({ ...common, action: z.enum(["DESIGNATION_RELEASE", "DESIGNATION_CANCEL"]), designationId: id }).strict(),
  z.object({ ...common, action: z.literal("CONDITIONAL_REVIEW"), bankTransactionId: id, policyEvidence: evidence }).strict(),
  z.object({ ...common, action: z.literal("RESOLVE_CONDITIONAL"), parentId: id, bankTransactionId: id, sourceJournalLineId: id, policyEvidence: evidence }).strict(),
  z.object({ ...common, action: z.literal("REOPEN_CONDITIONAL"), parentId: id }).strict()
]);
export const fundKindSchema = z.enum(["FUND_SETUP", "FUND_RESTRICTION", "FUND_DESIGNATION", "FUND_RELEASE", "FUND_COMMAND", "FUND_JOURNAL"]);
export const fundApprovalSchema = z.object({ kind: fundKindSchema, sourceDocumentId: id, expectedRevision: z.number().int().positive(), release: releaseInputSchema.optional() }).strict();
export type FundInput = z.infer<typeof fundInputSchema>;
export type RestrictionInput = z.infer<typeof restrictionInputSchema>;
export type DesignationInput = z.infer<typeof designationInputSchema>;
export type FundMovement = z.infer<typeof fundMovementSchema>;
export type FundCommand = z.infer<typeof fundCommandSchema>;
export type ReleaseInput = z.infer<typeof releaseInputSchema>;
