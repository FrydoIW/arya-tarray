import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { AccountingQuery } from "./accounting.schema.js";
import { accountingSourceInclude } from "./accounting.posting.js";

export function dimensionWhere(q: AccountingQuery): Prisma.AccountingJournalLineWhereInput {
  return { bankAccountId: q.bankAccountId, eventCodeId: q.eventCodeId, eventCampaignId: q.eventCampaignId,
    memberId: q.memberId, eventTypeSnapshot: q.eventType };
}
export function journalWhere(q: AccountingQuery): Prisma.AccountingJournalWhereInput {
  return { accountingDate: { gte: new Date(q.from), ...(q.to ? { lte: new Date(q.to) } : {}) },
    journalType: q.journalType, journalNumber: q.journalNumber ? { contains: q.journalNumber } : undefined,
    lines: { some: dimensionWhere(q) } };
}
function sourceWhere(q: AccountingQuery): Prisma.BankTransactionWhereInput {
  return { transactionDate: { gte: new Date(q.from), ...(q.to ? { lte: new Date(q.to) } : {}) },
    statementUpload: { is: { bankAccountId: q.bankAccountId, status: { not: "WITHDRAWN" } } },
    eventCodeId: q.eventCodeId, eventCampaignId: q.eventCampaignId,
    eventCode: q.eventType ? { is: { eventType: q.eventType } } : undefined,
    memberIdentity: q.memberId ? { is: { memberId: q.memberId, verificationStatus: "VERIFIED" } } : undefined };
}

/** Repeatable snapshot keeps page, totals and exports internally consistent. No source writes. */
export async function loadAccountingReport(q: AccountingQuery, exportAll = false) {
  return prisma.$transaction(async tx => {
    const max = exportAll ? 10001 : q.pageSize;
    const where = journalWhere(q);
    const lineWhere: Prisma.AccountingJournalLineWhereInput = {
      journal: { is: where }, ...(["trial", "journals"].includes(q.view) ? {} : dimensionWhere(q)),
      ...(q.view === "monthly" ? { accountCodeSnapshot: "4110" } : {}),
      ...(q.view === "ledger" && q.accountCode ? { accountCodeSnapshot: q.accountCode } : {})
    };
    const totals = await tx.accountingJournalLine.aggregate({ where: lineWhere, _sum: { debit: true, credit: true } });
    if (q.view === "journals") {
      const total = await tx.accountingJournal.count({ where });
      const page = Math.min(q.page, Math.max(1, Math.ceil(total / q.pageSize)));
      const rows = await tx.accountingJournal.findMany({ where, include: { lines: { orderBy: { lineNo: "asc" } } },
        orderBy: [{ accountingDate: "desc" }, { postedAt: "desc" }, { id: "desc" }], take: max,
        skip: exportAll ? 0 : (page - 1) * q.pageSize });
      return { kind: "journals" as const, rows, total, page, totals };
    }
    if (q.view === "ledger") {
      const total = await tx.accountingJournalLine.count({ where: lineWhere });
      const page = Math.min(q.page, Math.max(1, Math.ceil(total / q.pageSize)));
      const rows = await tx.accountingJournalLine.findMany({ where: lineWhere, include: { journal: true },
        orderBy: [{ journal: { accountingDate: "asc" } }, { journal: { postedAt: "asc" } }, { journalId: "asc" }, { lineNo: "asc" }],
        take: max, skip: exportAll ? 0 : (page - 1) * q.pageSize });
      return { kind: "ledger" as const, rows, total, page, totals };
    }
    if (q.view === "trial") {
      const rows = await tx.accountingJournalLine.groupBy({ by: ["accountCodeSnapshot", "accountNameSnapshot"],
        where: lineWhere, _sum: { debit: true, credit: true }, orderBy: { accountCodeSnapshot: "asc" } });
      return { kind: "trial" as const, rows, total: rows.length, page: 1, totals };
    }
    if (q.view === "monthly") {
      const filter = Prisma.sql`j.accounting_date >= ${new Date(q.from)}
        ${q.to ? Prisma.sql`AND j.accounting_date <= ${new Date(q.to)}` : Prisma.empty}
        ${q.bankAccountId ? Prisma.sql`AND l.bank_account_id = ${q.bankAccountId}` : Prisma.empty}
        ${q.eventCodeId ? Prisma.sql`AND l.event_code_id = ${q.eventCodeId}` : Prisma.empty}
        ${q.eventCampaignId ? Prisma.sql`AND l.event_campaign_id = ${q.eventCampaignId}` : Prisma.empty}
        ${q.memberId ? Prisma.sql`AND l.member_id = ${q.memberId}` : Prisma.empty}
        ${q.eventType ? Prisma.sql`AND l.event_type_snapshot = ${q.eventType}` : Prisma.empty}
        ${q.journalType ? Prisma.sql`AND j.journal_type = ${q.journalType}` : Prisma.empty}
        ${q.journalNumber ? Prisma.sql`AND INSTR(j.journal_number, ${q.journalNumber}) > 0` : Prisma.empty}`;
      const rows = await tx.$queryRaw<Array<{ month: string; bank: string; event: string | null; eventType: string | null;
        campaign: string | null; debit: Prisma.Decimal; credit: Prisma.Decimal; journals: bigint }>>`
        SELECT DATE_FORMAT(j.accounting_date, '%Y-%m') AS month,
          l.bank_account_name_snapshot AS bank, l.event_name_snapshot AS event, l.event_type_snapshot AS eventType,
          l.campaign_name_snapshot AS campaign, SUM(l.debit) AS debit, SUM(l.credit) AS credit, COUNT(*) AS journals
        FROM arya_accounting_journal_line l JOIN arya_accounting_journal j USING(accounting_journal_id)
        WHERE l.account_code_snapshot='4110' AND ${filter}
        GROUP BY month, l.bank_account_id, bank, l.event_code_id, event, eventType, l.event_campaign_id, campaign
        ORDER BY month, bank, event, campaign LIMIT 10001`;
      return { kind: "monthly" as const, rows, total: rows.length, page: 1, totals };
    }
    const sourceFilter = sourceWhere(q);
    const sourceScope: Prisma.BankTransactionWhereInput = q.view === "pending"
      ? { AND: [sourceFilter, { statementUpload: { is: { status: "CHECK", approval: { is: { status: "PENDING" } } } } }] }
      : { AND: [sourceFilter, { status: "FINALIZED" }] };
    const total = await tx.bankTransaction.count({ where: sourceScope });
    const page = Math.min(q.page, Math.max(1, Math.ceil(total / q.pageSize)));
    const rows = await tx.bankTransaction.findMany({ where: sourceScope, include: { ...accountingSourceInclude,
      accountingJournals: { include: { lines: true }, orderBy: [{ postedAt: "asc" }, { createdAt: "asc" }] },
      correctionItems: { where: { proposal: { is: { status: "PENDING" } } },
        include: { proposedEventCode: true, proposedEventCampaign: true }, take: 1 }
    }, orderBy: [{ transactionDate: "desc" }, { id: "desc" }], take: max, skip: exportAll ? 0 : (page - 1) * q.pageSize });
    // ADDED proposal rows do not have a BankTransaction yet. Expose a separate bounded preview list.
    const additions = q.view === "pending" && !q.memberId ? await tx.reconciliationCorrectionItem.findMany({
      where: { action: "ADDED", proposal: { is: { status: "PENDING", approval: { is: { status: "PENDING" } },
        statementUpload: { is: { bankAccountId: q.bankAccountId } } } },
        manualTransactionDate: { gte: new Date(q.from), ...(q.to ? { lte: new Date(q.to) } : {}) },
        proposedEventCodeId: q.eventCodeId, proposedEventCampaignId: q.eventCampaignId,
        proposedEventCode: q.eventType ? { is: { eventType: q.eventType } } : undefined },
      select: { id: true, manualDescription: true, manualTransactionDate: true, manualOriginalAmount: true, proposalId: true },
      take: 100, orderBy: { id: "asc" }
    }) : [];
    return { kind: "source" as const, rows, additions, total, page, totals };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 });
}

export function loadAccountingJournal(id: string) {
  return prisma.accountingJournal.findUnique({ where: { id }, include: {
    lines: { orderBy: { lineNo: "asc" } }, linkedJournals: { select: { id: true, journalNumber: true, journalType: true } },
    bankTransaction: { select: { id: true, rowNo: true, referenceNo: true, sourceType: true, reconciliationExcludedAt: true,
      statementUpload: { select: { id: true, fileName: true, status: true, approval: { select: { id: true, status: true } } } } } },
    correctionItem: { select: { id: true, action: true, proposalId: true } }
  } });
}

export async function loadAccountingOptions(memberSearch: string) {
  const [banks, events, campaigns, members] = await Promise.all([
    prisma.bankAccount.findMany({ select: { id: true, accountName: true }, orderBy: { accountName: "asc" }, take: 500 }),
    prisma.eventCode.findMany({ select: { id: true, code: true, eventName: true }, orderBy: { code: "asc" }, take: 500 }),
    prisma.eventCampaign.findMany({ select: { id: true, campaignName: true }, orderBy: { campaignName: "asc" }, take: 1000 }),
    prisma.member.findMany({ where: { memberName: { contains: memberSearch } },
      select: { id: true, memberCode: true, memberName: true }, orderBy: { memberName: "asc" }, take: 50 })
  ]);
  return { banks: banks.map(r => ({ id: r.id, label: r.accountName })),
    events: events.map(r => ({ id: r.id, label: `${r.code} ${r.eventName}` })),
    campaigns: campaigns.map(r => ({ id: r.id, label: r.campaignName })),
    members: members.map(r => ({ id: r.id, label: `${r.memberCode} ${r.memberName}` })),
    limits: { banks: 500, events: 500, campaigns: 1000, members: 50 } };
}
