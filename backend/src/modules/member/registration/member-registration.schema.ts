import { z } from "zod";
import { memberProfileFieldSchemas, optionalMemberText } from "../member-profile.schema.js";

export const memberInputSchema = z.object({
  ...memberProfileFieldSchemas
});
export const workspaceQuerySchema = z.object({
  search: z.string().trim().max(150).default(""),
  status: z.enum(["UNVERIFIED", "VERIFIED", "IGNORED", "ALL"]).default("UNVERIFIED"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});
export const identityParamsSchema = z.object({ identityId: z.string().uuid() });
export const linkSchema = z.object({ memberId: z.string().uuid() });
export const ignoreSchema = z.object({ remark: optionalMemberText(500) });
export const optionsQuerySchema = z.object({ search: z.string().trim().max(150).default("") });
export type MemberInput = z.infer<typeof memberInputSchema>;
export type WorkspaceQuery = z.infer<typeof workspaceQuerySchema>;
