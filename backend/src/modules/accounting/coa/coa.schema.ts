import { z } from "zod";

const accountCode = z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9.-]+$/);
const accountType = z.enum(["ASSET", "LIABILITY", "NET_ASSET", "REVENUE", "EXPENSE"]);
const optionalText = (length: number) => z.string().trim().max(length).nullable();

export const accountQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  type: accountType.optional(),
  active: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

export const createAccountSchema = z.object({
  code: accountCode,
  name: z.string().trim().min(1).max(150),
  parentAccountId: z.string().uuid().nullable().default(null),
  accountType,
  accountClassification: optionalText(40).default(null),
  reportSection: optionalText(40).default(null),
  normalBalance: z.enum(["DEBIT", "CREDIT"]),
  contraFlag: z.boolean().default(false),
  postingFlag: z.boolean(),
  activeFlag: z.boolean().default(true)
});

export const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  parentAccountId: z.string().uuid().nullable().optional(),
  accountClassification: optionalText(40).optional(),
  reportSection: optionalText(40).optional(),
  normalBalance: z.enum(["DEBIT", "CREDIT"]).optional(),
  contraFlag: z.boolean().optional(),
  postingFlag: z.boolean().optional(),
  activeFlag: z.boolean().optional()
}).strict().refine(value => Object.keys(value).length > 0);

export type AccountQuery = z.infer<typeof accountQuerySchema>;
export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
