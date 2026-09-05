import { z } from "zod";
import { currentBusinessDayValue } from "../../../lib/business-time.js";
import { isValidPeriodDate } from "../../../lib/period.js";

const optionalText = (max: number) => z.string().trim().max(max).nullish().transform(value => value || null);
export const memberInputSchema = z.object({
  memberName: z.string().trim().min(1).max(150),
  initialName: optionalText(100),
  birthDate: optionalText(10).refine(value => !value || (isValidPeriodDate(value) && value <= currentBusinessDayValue()), "Birth date must be a valid non-future YYYY-MM-DD date"),
  phone: optionalText(50),
  email: optionalText(150).refine(value => !value || z.string().email().safeParse(value).success, "Email is invalid"),
  city: optionalText(100), address: optionalText(500), remark: optionalText(500)
});
export const workspaceQuerySchema = z.object({
  search: z.string().trim().max(150).default(""),
  status: z.enum(["UNVERIFIED", "VERIFIED", "IGNORED", "ALL"]).default("UNVERIFIED"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});
export const identityParamsSchema = z.object({ identityId: z.string().uuid() });
export const linkSchema = z.object({ memberId: z.string().uuid() });
export const ignoreSchema = z.object({ remark: optionalText(500) });
export const optionsQuerySchema = z.object({ search: z.string().trim().max(150).default("") });
export type MemberInput = z.infer<typeof memberInputSchema>;
export type WorkspaceQuery = z.infer<typeof workspaceQuerySchema>;
