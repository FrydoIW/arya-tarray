import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import type { LedgerReportQuery } from "./ledger-report.schema.js";
import { HttpError } from "../../../lib/http.js";

const utc = (value: string) => new Date(`${value}T00:00:00.000Z`);
async function resolveScope(tx: Prisma.TransactionClient, q: LedgerReportQuery) {
  if (!q.accountingPeriodId) return q;
  const p = await tx.accountingPeriod.findUnique({ where: { id: q.accountingPeriodId } }); if (!p) throw new HttpError(404, "Reporting period not found.");
  if (utc(q.to) > p.endDate || utc(q.to) < p.startDate || q.from && utc(q.from) < p.startDate) throw new HttpError(400, "Ledger range must remain within its selected period.");
  return { ...q, from: q.from ?? p.startDate.toISOString().slice(0, 10) };
}

export function loadGeneralLedger(query: LedgerReportQuery) {
  return prisma.$transaction(async tx => {
    query = await resolveScope(tx, query);
    const date: Prisma.DateTimeFilter = { lte: utc(query.to), ...(query.from ? { gte: utc(query.from) } : {}) };
    const where: Prisma.AccountingJournalLineWhereInput = {
      accountId: query.accountId, accountingFundId: query.accountingFundId, eventCampaignId: query.eventCampaignId,
      journal: { is: { accountingDate: date, accountingPeriodId: query.accountingPeriodId } }
    };
    const [total, sums, rows, opening, movement, running] = await Promise.all([
      tx.accountingJournalLine.count({ where }),
      tx.accountingJournalLine.aggregate({ where, _sum: { debit: true, credit: true } }),
      tx.accountingJournalLine.findMany({ where,
        select: { id: true, lineNo: true, accountId: true, accountCodeSnapshot: true,
          accountNameSnapshot: true, debit: true, credit: true, accountingFundId: true,
          fundRestrictionId: true, counterpartyId: true, bankAccountId: true,
          journal: { select: { id: true, journalNumber: true, journalType: true,
            accountingDate: true, sourceKind: true, sourceReference: true, postedAt: true } } },
        orderBy: [{ journal: { accountingDate: "asc" } }, { journal: { postedAt: "asc" } },
          { journalId: "asc" }, { lineNo: "asc" }],
        skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      query.from ? tx.accountingJournalLine.groupBy({ by: ["accountId"], where: { accountId: query.accountId, accountingFundId: query.accountingFundId, eventCampaignId: query.eventCampaignId, journal: { accountingDate: { lt: utc(query.from) } } }, _sum: { debit: true, credit: true } }) : Promise.resolve([]),
      tx.accountingJournalLine.groupBy({ by: ["accountId"], where, _sum: { debit: true, credit: true } }),
      tx.$queryRaw<{ id: string; runningNet: Prisma.Decimal }[]>(Prisma.sql`WITH opens AS (
        SELECT l.accounting_account_id AS accountId,SUM(l.debit-l.credit) AS amount FROM arya_accounting_journal_line l JOIN arya_accounting_journal j USING(accounting_journal_id) WHERE j.accounting_date<${utc(query.from ?? "1900-01-01")} ${query.accountingFundId ? Prisma.sql`AND l.accounting_fund_id=${query.accountingFundId}` : Prisma.empty} ${query.eventCampaignId ? Prisma.sql`AND l.event_campaign_id=${query.eventCampaignId}` : Prisma.empty} GROUP BY l.accounting_account_id
      ), ordered AS (SELECT l.accounting_journal_line_id AS id,j.accounting_date AS dt,j.posted_at AS posted,j.accounting_journal_id AS jid,l.line_no AS no,
        COALESCE(o.amount,0)+SUM(l.debit-l.credit) OVER(PARTITION BY l.accounting_account_id ORDER BY j.accounting_date,j.posted_at,j.accounting_journal_id,l.line_no ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS runningNet
        FROM arya_accounting_journal_line l JOIN arya_accounting_journal j USING(accounting_journal_id) LEFT JOIN opens o ON o.accountId=l.accounting_account_id WHERE j.accounting_date>=${utc(query.from ?? "1900-01-01")} AND j.accounting_date<=${utc(query.to)}
        ${query.accountId ? Prisma.sql`AND l.accounting_account_id=${query.accountId}` : Prisma.empty} ${query.accountingFundId ? Prisma.sql`AND l.accounting_fund_id=${query.accountingFundId}` : Prisma.empty} ${query.eventCampaignId ? Prisma.sql`AND l.event_campaign_id=${query.eventCampaignId}` : Prisma.empty} ${query.accountingPeriodId ? Prisma.sql`AND j.accounting_period_id=${query.accountingPeriodId}` : Prisma.empty})
        SELECT id,runningNet FROM ordered ORDER BY dt,posted,jid,no LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`)
    ]);
    return { total, sums, rows, opening, movement, running };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export function loadTrialBalance(query: LedgerReportQuery) {
  return prisma.$transaction(async tx => {
    query = await resolveScope(tx, query);
    const accountWhere: Prisma.AccountingAccountWhereInput = {
      postingFlag: true, id: query.accountId
    };
    const [total, accounts] = await Promise.all([
      tx.accountingAccount.count({ where: accountWhere }),
      tx.accountingAccount.findMany({ where: accountWhere,
        select: { id: true, code: true, name: true, parentAccountId: true, accountType: true, normalBalance: true,
          contraFlag: true, reportSection: true, accountClassification: true },
        orderBy: [{ code: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize, take: query.pageSize })
    ]);
    const ids = accounts.map(account => account.id);
    const lineWhere = (date: Prisma.DateTimeFilter): Prisma.AccountingJournalLineWhereInput => ({
      accountId: { in: ids }, accountingFundId: query.accountingFundId, eventCampaignId: query.eventCampaignId,
      journal: { is: { accountingDate: date } }
    });
    const [opening, movement, allSums] = await Promise.all([
      query.from && ids.length ? tx.accountingJournalLine.groupBy({ by: ["accountId"],
        where: lineWhere({ lt: utc(query.from) }), _sum: { debit: true, credit: true } }) : Promise.resolve([]),
      ids.length ? tx.accountingJournalLine.groupBy({ by: ["accountId"],
        where: lineWhere({ lte: utc(query.to), ...(query.from ? { gte: utc(query.from) } : {}) }),
        _sum: { debit: true, credit: true } }) : Promise.resolve([]),
      tx.accountingJournalLine.aggregate({ where: {
        accountingFundId: query.accountingFundId,
        eventCampaignId: query.eventCampaignId,
        journal: { is: { accountingDate: { lte: utc(query.to) } } }
      }, _sum: { debit: true, credit: true } })
    ]);
    return { total, accounts, opening, movement, allSums };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
