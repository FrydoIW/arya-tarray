import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { commandOf } from "./fund.repository.js";
import { cents } from "./fund.domain.js";
/** Explicit conditional holds are transactional recognition policy, never environment guards. */
export async function resolvedFundBankIds(tx: Prisma.TransactionClient, ids: string[]) {
  const decisions = await tx.accountingJournalDraft.findMany({ where: { fundActiveBankId: { in: ids } }, include: {
    fund25_fundSourceLineId: { include: { account: true, journal: { include: { revFkAccJournalReversal: true, lines: true } } } },
    fund25_fundBankTransactionId: { include: { statementUpload: true } }, fund25_accountingFundId: true
  } });
  const resolved = new Set<string>();
  for (const d of decisions) {
    const c = commandOf(d);
    if (d.status !== "APPLIED" || c.action !== "RESOLVE_CONDITIONAL" || !d.fundSourceLineId || !d.fundActiveBankId) throw new HttpError(409, "REVIEW_REQUIRED: conditional bank contribution has an unresolved recognition policy.");
    const line = d.fund25_fundSourceLineId, bank = d.fund25_fundBankTransactionId, fund = d.fund25_accountingFundId;
    if (!line || !bank || !fund || fund.status !== "ACTIVE" || line.journal.revFkAccJournalReversal || line.journal.journalType === "REVERSAL"
      || bank.reconciliationExcludedAt || cents(bank.originalAmount) !== cents(line.credit) || line.account.accountType !== (fund.fundClass === "CONDITIONAL_LIABILITY" ? "LIABILITY" : "REVENUE")
      || line.journal.lines.filter(l => l.bankAccountId === bank.statementUpload.bankAccountId && l.accountId !== line.accountId).reduce((n, l) => n + cents(l.debit) - cents(l.credit), 0n) !== cents(bank.originalAmount)) throw new HttpError(409, "REVIEW_REQUIRED: conditional bank/GL evidence changed; obtain an approved policy correction.");
    resolved.add(d.fundActiveBankId);
  }
  return resolved;
}
