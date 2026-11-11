import { accountingTotalCents } from "../accounting.domain.js";
import { centsToDecimal } from "../../../lib/money.js";
import { loadGeneralLedger, loadTrialBalance } from "./ledger-report.repository.js";
import type { LedgerReportQuery } from "./ledger-report.schema.js";

const cents = (amount: { toFixed(n: number): string } | null | undefined) => accountingTotalCents(amount?.toFixed(2) ?? "0.00");

export async function getGeneralLedger(query: LedgerReportQuery) {
  const result = await loadGeneralLedger(query);
  const opening = new Map(result.opening.map(r => [r.accountId, cents(r._sum.debit) - cents(r._sum.credit)]));
  const movement = new Map(result.movement.map(r => [r.accountId, cents(r._sum.debit) - cents(r._sum.credit)])), running = new Map(result.running.map(r => [r.id, r.runningNet.toFixed(2)]));
  return { page: query.page, pageSize: query.pageSize, total: result.total,
    openingBalances: [...opening].map(([accountId, value]) => ({ accountId, balance: centsToDecimal(value) })),
    closingBalances: [...new Set([...opening.keys(), ...movement.keys()])].map(accountId => ({ accountId, balance: centsToDecimal((opening.get(accountId) ?? 0n) + (movement.get(accountId) ?? 0n)) })),
    totalDebit: centsToDecimal(cents(result.sums._sum.debit)),
    totalCredit: centsToDecimal(cents(result.sums._sum.credit)),
    rows: result.rows.map(row => ({ ...row, debit: row.debit.toFixed(2), credit: row.credit.toFixed(2), runningBalance: running.get(row.id) ?? null })) };
}

export async function getTrialBalance(query: LedgerReportQuery) {
  const result = await loadTrialBalance(query);
  const opening = new Map(result.opening.map(row => [row.accountId, cents(row._sum.debit) - cents(row._sum.credit)]));
  const movement = new Map(result.movement.map(row => [row.accountId, cents(row._sum.debit) - cents(row._sum.credit)]));
  const movements = new Map(result.movement.map(row => [row.accountId, row._sum]));
  const rows = result.accounts.map(account => {
    const openingNet = opening.get(account.id) ?? 0n;
    const movementNet = movement.get(account.id) ?? 0n;
    const closing = openingNet + movementNet;
    return { ...account, openingDebit: centsToDecimal(openingNet > 0n ? openingNet : 0n),
      openingCredit: centsToDecimal(openingNet < 0n ? -openingNet : 0n),
      movementNet: centsToDecimal(movementNet),
      movementDebit: centsToDecimal(cents(movements.get(account.id)?.debit)), movementCredit: centsToDecimal(cents(movements.get(account.id)?.credit)),
      closingDebit: centsToDecimal(closing > 0n ? closing : 0n),
      closingCredit: centsToDecimal(closing < 0n ? -closing : 0n) };
  });
  const totalDebit = cents(result.allSums._sum.debit);
  const totalCredit = cents(result.allSums._sum.credit);
  return { page: query.page, pageSize: query.pageSize, total: result.total,
    asOf: query.to, totalDebit: centsToDecimal(totalDebit), totalCredit: centsToDecimal(totalCredit),
    balanced: totalDebit === totalCredit, rows };
}
