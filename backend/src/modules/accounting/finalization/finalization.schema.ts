import { z } from "zod";
import { dateOnly } from "../period/period.schema.js";
import { exactPositiveAmount } from "../apar/apar.schema.js";
const id = z.string().uuid(), evidence = z.string().trim().min(10).max(2000);
export const signedAmount = z.string().regex(/^-?\d{1,18}(\.\d{1,2})?$/);
export const activity = z.enum(["OPERATING", "INVESTING", "FINANCING"]);
export const policySchema = z.object({ policyReference: evidence, frameworkReference: evidence, cashFlowMethod: z.literal("DIRECT"), materiality: z.literal("STRICT_ZERO"),
  cutoverCoverageEvidence: evidence, openingBalanceEvidence: evidence,
  mappings: z.array(z.object({ accountId: id, section: z.enum(["CURRENT_ASSETS", "NONCURRENT_ASSETS", "CURRENT_LIABILITIES", "NONCURRENT_LIABILITIES", "NET_ASSETS", "INCOME", "EXPENSES"]),
    statementLine: z.string().trim().min(1).max(100), incomeClass: z.enum(["CONTRIBUTIONS", "OTHER_INCOME", "PROGRAM", "FUNDRAISING", "ADMINISTRATIVE", "DEPRECIATION", "OTHER_EXPENSE"]).nullable(),
    netAssetClass: z.enum(["UNRESTRICTED", "RESTRICTED"]).nullable(), cashEquivalent: z.boolean(), cashFlowActivity: activity.nullable() }).strict()).max(1000),
  bankAccounts: z.array(z.object({ bankAccountId: id, glAccountId: id, openingEvidence: evidence }).strict()).max(100),
  controls: z.object({ payable: z.array(id).max(100), receivable: z.array(id).max(100) }).strict(),
  annual: z.object({ policyReference: evidence, unrestrictedAccountId: id, restrictedAccountId: id }).strict().nullable()
}).strict().refine(p => new Set(p.mappings.map(m => m.accountId)).size === p.mappings.length && new Set(p.bankAccounts.map(b => b.bankAccountId)).size === p.bankAccounts.length, "Duplicate mapping");
export const reportQuerySchema = z.object({ fiscalYearId: id, from: dateOnly, to: dateOnly, accountingFundId: id.optional(), eventCampaignId: id.optional(),
  comparativeFrom: dateOnly.optional(), comparativeTo: dateOnly.optional() }).strict().refine(v => v.from <= v.to && Boolean(v.comparativeFrom) === Boolean(v.comparativeTo) && (!v.comparativeFrom || v.comparativeFrom <= (v.comparativeTo ?? "")), "Invalid date/comparative range");
export const bankReconInputSchema = z.object({ bankAccountId: id, bankGlAccountId: id, accountingPeriodId: id, statementUploadId: id.nullable().default(null),
  reconciliationReference: z.string().trim().min(1).max(100), statementOpeningBalance: signedAmount, statementClosingBalance: signedAmount, openingEvidence: evidence, statementEvidence: evidence,
  timingItems: z.array(z.object({ kind: z.enum(["OUTSTANDING_PAYMENT", "DEPOSIT_IN_TRANSIT"]), journalLineId: id, amount: exactPositiveAmount, evidence }).strict()).max(500)
}).strict();
export const matchInputSchema = z.object({ bankTransactionId: id, journalLineId: id, amount: exactPositiveAmount, evidence }).strict();
export const finalKindSchema = z.enum(["REPORTING_POLICY", "BANK_RECONCILIATION", "PERIOD_CLOSE", "PERIOD_REOPEN", "YEAR_CLOSE", "YEAR_REOPEN", "REPORT_SNAPSHOT"]);
export const finalApprovalSchema = z.object({ kind: finalKindSchema, sourceDocumentId: id, expectedRevision: z.number().int().positive(), commandId: id.optional(), bankAction: z.literal("REOPEN").optional(), reason: evidence.optional(), evidenceReference: evidence.optional() }).strict();
export const closeInputSchema = z.object({ reason: evidence, evidenceReference: evidence }).strict();
export const pageSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
export type ReportingPolicy = z.infer<typeof policySchema>;
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type BankReconInput = z.infer<typeof bankReconInputSchema>;
export type MatchInput = z.infer<typeof matchInputSchema>;
