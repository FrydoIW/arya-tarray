import { z } from "zod";
import { isValidPeriodDate } from "../../../lib/period.js";
import { memberProfileFieldSchemas, optionalMemberText } from "../member-profile.schema.js";


export const memberDataWorkspaceQuerySchema = z.object({
  search: z.string().trim().max(150).default(""),
  status: z.enum(["ACTIVE", "INACTIVE", "ALL"]).default("ACTIVE"),
  city: z.string().trim().max(100).default(""),
  registrationSource: z.enum(["MANUAL", "STATEMENT", "ALL"]).default("ALL"),
  periodMode: z.enum(["MONTH", "DAY"]).default("MONTH"),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  date: z.string().refine(isValidPeriodDate, "Date must use YYYY-MM-DD format").optional(),
  eventCodeId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
}).superRefine((value, context) => {
  if (value.periodMode === "DAY" && !value.date) context.addIssue({ code: z.ZodIssueCode.custom, path: ["date"], message: "Date is required when periodMode is DAY" });
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
  remark: memberProfileFieldSchemas.remark.optional(),
  activeFlag: z.boolean().optional()
}).strict().refine(value => Object.keys(value).length > 0, "At least one profile field is required");

export const identityMetadataSchema = z.object({
  initialName: optionalMemberText(100).optional(),
  remark: optionalMemberText(500).optional()
}).strict().refine(value => Object.keys(value).length > 0, "At least one identity field is required");

export const moveIdentitySchema = z.object({ destinationMemberId: z.string().uuid() }).strict();

export const memberDonationQuerySchema = z.object({
  periodMode: z.enum(["MONTH", "DAY"]).default("MONTH"),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  date: z.string().refine(isValidPeriodDate, "Date must use YYYY-MM-DD format").optional(),
  eventCodeId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
}).superRefine((value, context) => {
  if (value.periodMode === "DAY" && !value.date) context.addIssue({ code: z.ZodIssueCode.custom, path: ["date"], message: "Date is required when periodMode is DAY" });
});

export type MemberDataWorkspaceQuery = z.infer<typeof memberDataWorkspaceQuerySchema>;
export type MemberProfileInput = z.infer<typeof memberProfileSchema>;
export type IdentityMetadataInput = z.infer<typeof identityMetadataSchema>;
export type MemberDonationQuery = z.infer<typeof memberDonationQuerySchema>;
