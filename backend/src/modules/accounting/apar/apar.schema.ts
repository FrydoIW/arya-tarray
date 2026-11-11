import { z } from "zod";
import { dateOnly } from "../period/period.schema.js";
import { accountingCents } from "../accounting.domain.js";

export const documentKindSchema = z.enum(["PAYABLE", "RECEIVABLE"]);
export type DocumentKind = z.infer<typeof documentKindSchema>;
export const exactPositiveAmount = z.string().regex(/^\d{1,18}(\.\d{1,2})?$/)
  .refine(value => { try { return accountingCents(value) > 0n; } catch { return false; } }, "Amount must be positive DECIMAL(20,2)");
const nullableId = z.string().uuid().nullable().default(null);
export const counterpartySchema = z.object({ counterpartyCode: z.string().trim().min(1).max(40),
  displayName: z.string().trim().min(1).max(200), counterpartyType: z.enum(["VENDOR", "DEBTOR", "BOTH"]),
  memberId: nullableId, activeFlag: z.boolean().default(true) }).strict();
export const counterpartyUpdateSchema = z.object({ displayName: z.string().trim().min(1).max(200).optional(),
  activeFlag: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0);
export const documentInputSchema = z.object({
  accrualDraftId: z.string().uuid().nullable().optional(),
  counterpartyId: z.string().uuid(), controlAccountId: z.string().uuid(),
  documentNumber: z.string().trim().min(1).max(100), sourceReference: z.string().trim().min(1).max(255),
  recognitionBasis: z.string().trim().min(10).max(1000),
  documentDate: dateOnly, accountingDate: dateOnly, dueDate: dateOnly,
  lines: z.array(z.object({ accountingAccountId: z.string().uuid(), description: z.string().trim().min(1).max(500),
    amount: exactPositiveAmount, accountingFundId: nullableId, eventCampaignId: nullableId }).strict()).min(1).max(200)
}).strict();
export const documentUpdateSchema = documentInputSchema.extend({ expectedRevision: z.number().int().positive() });
export const settlementInputSchema = z.object({ counterpartyId: z.string().uuid(),
  bankAccountId: z.string().uuid(), bankGlAccountId: z.string().uuid(),
  settlementReference: z.string().trim().min(1).max(100), sourceReference: z.string().trim().min(1).max(255),
  settlementDate: dateOnly, amount: exactPositiveAmount, bankTransactionId: nullableId,
  allocations: z.array(z.object({ accountingDocumentId: z.string().uuid(), allocatedAmount: exactPositiveAmount }).strict()).min(1).max(100)
}).strict();
export const settlementUpdateSchema = settlementInputSchema.extend({ expectedRevision: z.number().int().positive() });
export const adjustmentInputSchema = z.object({ adjustmentReference: z.string().trim().min(1).max(100),
  accountingDate: dateOnly, adjustmentKind: z.enum(["INCREASE", "DECREASE"]), amount: exactPositiveAmount,
  offsetAccountId: z.string().uuid(), reason: z.string().trim().min(10).max(500) }).strict();
export const subledgerListSchema = z.object({ search: z.string().trim().max(100).optional(),
  counterpartyId: z.string().uuid().optional(), status: z.enum(["DRAFT", "RECOGNIZED", "POSTED", "VOID"]).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
export const asOfSchema = subledgerListSchema.pick({ counterpartyId: true, page: true, pageSize: true })
  .extend({ asOf: dateOnly });
export const sourceSubmitSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
export const sourcePostSchema = z.object({ approvalRequestId: z.string().uuid() }).strict();
export const sourceReversalSchema = z.object({ accountingDate: dateOnly, remark: z.string().trim().min(1).max(1000) }).strict();
export const matchSettlementSchema = z.object({ bankTransactionId: z.string().uuid(),
  remark: z.string().trim().min(1).max(500) }).strict();
export const cancelSourceSchema = z.object({ reason: z.string().trim().min(1).max(1000), expectedRevision: z.number().int().positive() }).strict();
export type DocumentInput = z.infer<typeof documentInputSchema>;
export type SettlementInput = z.infer<typeof settlementInputSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentInputSchema>;
export type SubledgerQuery = z.infer<typeof subledgerListSchema>;
export type AsOfQuery = z.infer<typeof asOfSchema>;

