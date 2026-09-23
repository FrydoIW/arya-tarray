import { z } from "zod";
import { isValidPeriodDate } from "../../../lib/period.js";
import { decimalStringToCents } from "../../reconciliation/reconciliation-classification.js";
import { memberProfileFieldSchemas, optionalMemberText } from "../member-profile.schema.js";

const correctionReason = z.string().trim().min(3, "Reason minimal 3 karakter").max(1000);
const carryTransferIdempotencyKey = z.string().trim().min(1, "Idempotency key is required").max(100);
const carryTransferAmount = z.string().trim().regex(/^\d{1,18}(\.\d{1,2})?$/, "Amount must be a decimal with at most 2 decimals")
  .refine(value => !/^\d{1,18}(\.\d{1,2})?$/.test(value) || decimalStringToCents(value) > 0n, "Amount must be greater than zero");

export const memberDataWorkspaceQuerySchema = z.object({
  search: z.string().trim().max(150).default(""),
  status: z.enum(["ACTIVE", "INACTIVE", "ALL"]).default("ACTIVE"),
  city: z.string().trim().max(100).default(""),
  registrationSource: z.enum(["MANUAL", "STATEMENT", "ALL"]).default("ALL"),
  programBalance: z.enum(["ALL", "HAS_CARRY", "NO_CARRY"]).default("ALL"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

export const memberDataParamsSchema = z.object({ memberId: z.string().uuid() });
export const identityParamsSchema = z.object({ memberId: z.string().uuid(), identityId: z.string().uuid() });
export const identityOptionQuerySchema = z.object({ search: z.string().trim().max(150).default("") });
export const memberOptionQuerySchema = z.object({
  search: z.string().trim().max(150).default(""),
  excludeMemberId: z.string().uuid().optional()
});

export const memberProfileSchema = z.object({
  memberName: memberProfileFieldSchemas.memberName.optional(),
  initialName: memberProfileFieldSchemas.initialName.optional(),
  birthDate: memberProfileFieldSchemas.birthDate.optional(),
  phone: memberProfileFieldSchemas.phone.optional(),
  email: memberProfileFieldSchemas.email.optional(),
  address: memberProfileFieldSchemas.address.optional(),
  city: memberProfileFieldSchemas.city.optional(),
  remark: memberProfileFieldSchemas.remark.optional()
}).strict().refine(value => Object.keys(value).length > 0, "At least one profile field is required");

export const memberLifecycleSchema = z.object({ activeFlag: z.boolean() }).strict();

export const identityMetadataSchema = z.object({
  initialName: optionalMemberText(100).optional(),
  bankName: optionalMemberText(100).optional(),
  accountNumber: optionalMemberText(100).optional(),
  accountType: optionalMemberText(100).optional(),
  remark: optionalMemberText(500).optional()
}).strict().refine(value => Object.keys(value).length > 0, "At least one identity field is required");

export const moveIdentitySchema = z.object({ destinationMemberId: z.string().uuid(), reason: correctionReason }).strict();
export const detachIdentitySchema = z.object({ reason: correctionReason }).strict();

export const memberDonationQuerySchema = z.object({
  periodMode: z.enum(["MONTH", "DAY"]).default("MONTH"),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  date: z.string().refine(isValidPeriodDate, "Date must use YYYY-MM-DD format").optional(),
  eventCodeId: z.string().uuid().optional(),
  search: z.string().trim().max(150).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
}).superRefine((value, context) => {
  if (value.periodMode === "DAY" && !value.date) context.addIssue({ code: z.ZodIssueCode.custom, path: ["date"], message: "Date is required when periodMode is DAY" });
});

export const identityHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

export const subscriptionCreateSchema = z.object({
  eventCodeId: z.string().uuid(), referenceNo: z.string().trim().max(100).nullable(), displayName: z.string().trim().max(200).nullable(),
  remark: z.string().trim().max(1000).nullable()
}).strict();
export const campaignParticipationCreateSchema = z.object({
  eventCampaignId: z.string().uuid(),
  remark: z.string().trim().max(1000).nullable()
}).strict();
export const subscriptionUpdateSchema = z.object({
  referenceNo: z.string().trim().max(100).nullable(), displayName: z.string().trim().max(200).nullable(),
  remark: z.string().trim().max(1000).nullable()
}).strict();
export const subscriptionParamsSchema = z.object({ memberId: z.string().uuid(), subscriptionId: z.string().uuid() });
export const allocationSchema = z.object({ transactionId: z.string().uuid() });
export const openingCoverageParamsSchema = subscriptionParamsSchema.extend({ coverageId: z.string().uuid() });
export const voidOpeningCoverageSchema = z.object({ reason: correctionReason });
export const openingCoverageSchema = z.object({
  coverageFrom: z.string().refine(isValidPeriodDate, "Coverage start must use YYYY-MM-DD format"),
  coverageTo: z.string().refine(isValidPeriodDate, "Coverage end must use YYYY-MM-DD format"),
  remark: z.string().trim().min(3, "Opening coverage remark is required").max(1000)
}).refine(value => value.coverageFrom <= value.coverageTo, { path: ["coverageTo"], message: "Coverage end must not precede start" });

export const carryTransferParamsSchema = z.object({ memberId: z.string().uuid(), sourceSubscriptionId: z.string().uuid() });
export const campaignWalletTransferParamsSchema = z.object({ memberId: z.string().uuid(), sourceCampaignId: z.string().uuid() });
export const carryTransferCreateSchema = z.object({
  destinationSubscriptionId: z.string().uuid().optional(),
  destinationCampaignId: z.string().uuid().optional(),
  amount: carryTransferAmount,
  reason: correctionReason,
  idempotencyKey: carryTransferIdempotencyKey
}).strict().refine(value => Boolean(value.destinationSubscriptionId) !== Boolean(value.destinationCampaignId), {
  message: "Choose exactly one destination subscription or Campaign"
});
export const carryTransferReverseParamsSchema = z.object({ memberId: z.string().uuid(), transferId: z.string().uuid() });
export const carryTransferReverseSchema = z.object({
  reason: correctionReason,
  idempotencyKey: carryTransferIdempotencyKey
}).strict();
export const carryTransferHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

export type CarryTransferCreateInput = z.infer<typeof carryTransferCreateSchema>;
export type CarryTransferReverseInput = z.infer<typeof carryTransferReverseSchema>;
export type CarryTransferHistoryQuery = z.infer<typeof carryTransferHistoryQuerySchema>;
export type MemberDataWorkspaceQuery = z.infer<typeof memberDataWorkspaceQuerySchema>;
export type MemberProfileInput = z.infer<typeof memberProfileSchema>;
export type IdentityMetadataInput = z.infer<typeof identityMetadataSchema>;
export type MemberDonationQuery = z.infer<typeof memberDonationQuerySchema>;
export type IdentityHistoryQuery = z.infer<typeof identityHistoryQuerySchema>;
export type SubscriptionCreateInput = z.infer<typeof subscriptionCreateSchema>;
export type CampaignParticipationCreateInput = z.infer<typeof campaignParticipationCreateSchema>;
export type SubscriptionUpdateInput = z.infer<typeof subscriptionUpdateSchema>;
export type OpeningCoverageInput = z.infer<typeof openingCoverageSchema>;
