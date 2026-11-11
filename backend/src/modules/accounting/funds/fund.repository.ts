import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { accountingApprovalDigest } from "../approval/approval.domain.js";
import { fundPolicySchema, fundCommandSchema, fundMovementSchema } from "./fund.schema.js";
import { cents, assertCapacity } from "./fund.domain.js";
export async function loadFund(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.accountingFund.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Fund not found."); return row;
}
export async function loadRestriction(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.accountingFundRestriction.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Restriction not found."); return row;
}
export async function loadDesignation(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.accountingFundDesignation.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Designation not found."); return row;
}
export async function loadFundDraft(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.accountingJournalDraft.findUnique({ where: { id } });
  if (!row || !["FUND_COMMAND", "FUND_JOURNAL", "FUND_AUDIT"].includes(row.sourceKind) || !row.accountingFundId) throw new HttpError(404, "Fund movement/command not found.");
  return row;
}
export const commandOf = (row: { fundMetadata: unknown }) => fundCommandSchema.parse(row.fundMetadata);
export const movementOf = (row: { fundMetadata: unknown }) => fundMovementSchema.parse(row.fundMetadata);
/** Canonical approval material contains no floating numbers, Date, undefined or Decimal. */
export function material(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "number" ? String(item) : item));
}
export const digest = (value: unknown) => accountingApprovalDigest(material(value));
export async function policyFor(tx: Prisma.TransactionClient, fund: Awaited<ReturnType<typeof loadFund>>, active = true) {
  if (active && fund.status !== "ACTIVE") throw new HttpError(409, "Fund is not active.");
  const parsed = fundPolicySchema.safeParse(fund.policy);
  if (!parsed.success || fund.fundClass === "CONDITIONAL_REVIEW") throw new HttpError(409, "PENDING_POLICY: an explicitly adopted recognition policy is required.");
  const policy = parsed.data, account = await tx.accountingAccount.findUnique({ where: { id: policy.contributionAccountId } });
  const liability = fund.fundClass === "CONDITIONAL_LIABILITY";
  if (liability && !policy.conditionalObligationEvidence) throw new HttpError(409, "Conditional liability requires substantive obligation evidence.");
  if (!account || !account.activeFlag || !account.postingFlag || account.contraFlag || account.normalBalance !== "CREDIT"
    || account.accountType !== (liability ? "LIABILITY" : "REVENUE")) throw new HttpError(409, "Incorrect fund contribution classification/account mapping.");
  if (fund.balanceAccountId) {
    const balance = await tx.accountingAccount.findUnique({ where: { id: fund.balanceAccountId } });
    if (!balance?.activeFlag || !balance.postingFlag || balance.contraFlag || balance.normalBalance !== "CREDIT" || balance.accountType !== (liability ? "LIABILITY" : "NET_ASSET")) throw new HttpError(409, "Invalid fund net-assets/liability control mapping.");
  }
  if (policy.release) {
    if (fund.fundClass !== "DONOR_RESTRICTED") throw new HttpError(409, "Only donor-restricted funds may configure donor releases.");
    const mapping = policy.release, expected = mapping.mode === "REVENUE_RECLASSIFICATION" ? "REVENUE" : "NET_ASSET";
    const accounts = await tx.accountingAccount.findMany({ where: { id: { in: [mapping.debitAccountId, mapping.creditAccountId] } } });
    if (accounts.length !== new Set([mapping.debitAccountId, mapping.creditAccountId]).size || accounts.some(a => !a.activeFlag || !a.postingFlag || a.contraFlag || a.accountType !== expected || a.normalBalance !== "CREDIT")) throw new HttpError(409, "Release requires explicit active mappings of the approved account family.");
    if (expected === "REVENUE" && mapping.debitAccountId !== policy.contributionAccountId || expected === "NET_ASSET" && mapping.debitAccountId !== fund.balanceAccountId) throw new HttpError(409, "Release debit must match the restricted fund control account.");
  }
  return policy;
}
export async function fundDates(fund: Awaited<ReturnType<typeof loadFund>>, date: Date) {
  if (date < fund.effectiveOn || fund.expiresOn && date > fund.expiresOn) throw new HttpError(409, "Accounting date is outside fund effective dates.");
}
export const sourceInclude = { account: true, journal: { include: { revFkAccJournalReversal: true, bankTransaction: { include: { memberIdentity: true } } } } } satisfies Prisma.AccountingJournalLineInclude;
export async function sourceLine(tx: Prisma.TransactionClient, id: string, lock = true) {
  if (lock) await tx.$queryRaw`SELECT accounting_journal_line_id FROM arya_accounting_journal_line WHERE accounting_journal_line_id=${id} FOR UPDATE`;
  const line = await tx.accountingJournalLine.findUnique({ where: { id }, include: sourceInclude });
  if (!line || line.journal.journalType === "REVERSAL" || line.journal.revFkAccJournalReversal) throw new HttpError(409, "Source/evidence must be an actual unreversed posted journal line.");
  return line;
}
export async function releasedAmount(tx: Prisma.TransactionClient, id: string) {
  const sum = await tx.accountingFundRelease.aggregate({ where: { fundRestrictionId: id, activeEvidenceKey: { not: null } }, _sum: { amount: true } });
  return cents(sum._sum.amount ?? "0");
}
export async function sourceClaims(tx: Prisma.TransactionClient, id: string, except?: string) {
  const restrictions = await tx.accountingFundRestriction.aggregate({ where: { sourceJournalLineId: id, status: { not: "CANCELLED" }, ...(except ? { id: { not: except } } : {}) }, _sum: { originalAmount: true } });
  const drafts = await tx.$queryRaw<{ amount: Prisma.Decimal; invalid: Prisma.Decimal }[]>`SELECT COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(fund_metadata,'$.amount')) AS DECIMAL(20,2))),0) AS amount,
    COALESCE(SUM(IF(JSON_TYPE(JSON_EXTRACT(fund_metadata,'$.amount'))='STRING' AND JSON_UNQUOTE(JSON_EXTRACT(fund_metadata,'$.amount')) REGEXP '^[0-9]{1,18}([.][0-9]{1,2})?$',0,1)),0) AS invalid
    FROM arya_accounting_journal_draft WHERE source_kind='FUND_JOURNAL' AND fund_source_line_id=${id} AND status<>'CANCELLED' AND journal_draft_id<>${except ?? ""}`;
  if (Number(drafts[0]?.invalid ?? 0)) throw new HttpError(409, "Existing source claims have invalid monetary metadata; review required.");
  return cents(restrictions._sum.originalAmount ?? "0") + cents(drafts[0]?.amount ?? "0");
}
export async function assertSource(tx: Prisma.TransactionClient, fund: Awaited<ReturnType<typeof loadFund>>, id: string, amount: string, date: Date, except?: string, opening = false) {
  const policy = await policyFor(tx, fund), line = await sourceLine(tx, id);
  const expected = opening ? "NET_ASSET" : fund.fundClass === "CONDITIONAL_LIABILITY" ? "LIABILITY" : "REVENUE";
  if (line.account.accountType !== expected || !line.account.activeFlag || !line.account.postingFlag || line.account.contraFlag || line.account.normalBalance !== "CREDIT" || cents(line.credit) <= 0n || cents(line.debit) !== 0n || line.accountingFundId || line.fundRestrictionId
    || line.journal.accountingDate > date || ["FUND_CLASSIFY", "FUND_RESTRICTION", "FUND_RELEASE", "FUND_OPENING"].includes(line.journal.sourceKind ?? "")) throw new HttpError(409, "A contribution classification needs an original unclassified credit of the correct account family.");
  if (opening && (!fund.balanceAccountId || !["OPENING", "MANUAL"].includes(line.journal.journalType))) throw new HttpError(409, "Opening requires an existing opening/net-assets journal and explicit control mapping.");
  const bank = line.journal.bankTransaction;
  if (bank && (bank.status !== "FINALIZED" || bank.reconciliationExcludedAt || bank.originalAmount.lte(0))) throw new HttpError(409, "Bank contribution is no longer eligible; review its source evidence.");
  if (bank) {
    const decision = await tx.accountingJournalDraft.findUnique({ where: { fundActiveBankId: bank.id }, select: { status: true, fundSourceLineId: true } });
    if (decision && (decision.status !== "APPLIED" || decision.fundSourceLineId !== line.id)) throw new HttpError(409, "PENDING_POLICY: resolve the current conditional bank decision before fund classification.");
  }
  assertCapacity(cents(line.credit), await sourceClaims(tx, id, except), cents(amount));
  const restored = await tx.accountingJournal.findFirst({ where: { journalType: "REVERSAL", relFkAccJournalReversal: { is: { relatedJournalId: line.journalId, sourceKind: { in: ["FUND_CLASSIFY", "FUND_RESTRICTION", "FUND_OPENING"] } } } }, orderBy: { accountingDate: "desc" }, select: { accountingDate: true } });
  if (restored && date < restored.accountingDate) throw new HttpError(409, "Source cannot be reallocated before its prior classification reversal date.");
  await fundDates(fund, date);
  return { line, policy };
}
export async function netResources(tx: Prisma.TransactionClient, fundId: string) {
  const rows = await tx.$queryRaw<{ kind: string; amount: Prisma.Decimal }[]>`SELECT a.account_type AS kind,SUM(l.credit-l.debit) AS amount FROM arya_accounting_journal_line l JOIN arya_accounting_account a ON a.accounting_account_id=l.accounting_account_id WHERE l.accounting_fund_id=${fundId} AND a.account_type IN ('NET_ASSET','REVENUE','EXPENSE') GROUP BY a.account_type`;
  return rows.reduce((n, r) => n + cents(r.amount), 0n);
}
export async function designationCapacity(tx: Prisma.TransactionClient, fundId: string, amount: string, except?: string) {
  await tx.$queryRaw`SELECT accounting_fund_id FROM arya_accounting_fund WHERE accounting_fund_id=${fundId} FOR UPDATE`;
  const fund = await loadFund(tx, fundId); await policyFor(tx, fund);
  if (fund.fundClass !== "UNRESTRICTED") throw new HttpError(409, "Internal designations require unrestricted resources.");
  const sum = await tx.accountingFundDesignation.aggregate({ where: { accountingFundId: fundId, status: "ACTIVE", ...(except ? { id: { not: except } } : {}) }, _sum: { amount: true } });
  assertCapacity(await netResources(tx, fundId), cents(sum._sum.amount ?? "0"), cents(amount));
}
export const policySnapshot = async (tx: Prisma.TransactionClient, id: string) => material(await loadFund(tx, id));
