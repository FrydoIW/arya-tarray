import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { currentPolicy, readAccounting, cents, money, day, dateText, material, digest, ledgerFingerprint } from "./finalization.repository.js";
import type { ReportQuery, ReportingPolicy } from "./finalization.schema.js";
export async function validateReportingPolicy(tx: Prisma.TransactionClient, p: ReportingPolicy) {
  const ids = [...new Set([...p.mappings.map(m => m.accountId), ...p.controls.payable, ...p.controls.receivable, ...p.bankAccounts.map(b => b.glAccountId), ...(p.annual ? [p.annual.unrestrictedAccountId, p.annual.restrictedAccountId] : [])])];
  const accounts = await tx.accountingAccount.findMany({ where: { id: { in: ids } } }), byId = new Map(accounts.map(a => [a.id, a]));
  if (accounts.length !== ids.length) throw new HttpError(409, "Reporting mapping refers to missing accounts.");
  for (const m of p.mappings) { const a = byId.get(m.accountId); if (!a || !a.postingFlag) throw new HttpError(409, "Map posting accounts only.");
    const expected = a.accountType === "ASSET" ? ["CURRENT_ASSETS", "NONCURRENT_ASSETS"] : a.accountType === "LIABILITY" ? ["CURRENT_LIABILITIES", "NONCURRENT_LIABILITIES"] : a.accountType === "NET_ASSET" ? ["NET_ASSETS"] : a.accountType === "REVENUE" ? ["INCOME"] : ["EXPENSES"];
    if (!expected.includes(m.section) || m.cashEquivalent && (a.accountType !== "ASSET" || a.contraFlag || a.normalBalance !== "DEBIT") || a.accountType === "REVENUE" && !["CONTRIBUTIONS", "OTHER_INCOME"].includes(m.incomeClass ?? "")
      || a.accountType === "EXPENSE" && !["PROGRAM", "FUNDRAISING", "ADMINISTRATIVE", "DEPRECIATION", "OTHER_EXPENSE"].includes(m.incomeClass ?? "")) throw new HttpError(409, "Statement/cash/functional mapping conflicts with the account type.");
  }
  if (p.controls.payable.some(id => byId.get(id)?.accountType !== "LIABILITY") || p.controls.receivable.some(id => byId.get(id)?.accountType !== "ASSET")) throw new HttpError(409, "AP/AR controls require liability/asset accounts.");
  if (p.bankAccounts.length && await tx.bankAccount.count({ where: { id: { in: p.bankAccounts.map(b => b.bankAccountId) }, activeFlag: true } }) !== p.bankAccounts.length) throw new HttpError(409, "Reporting bank identities must exist and be active.");
  if (p.bankAccounts.some(b => !p.mappings.some(m => m.accountId === b.glAccountId && m.cashEquivalent))) throw new HttpError(409, "Bank reconciliation controls must be explicit cash-equivalent mappings.");
  if (p.annual && [p.annual.unrestrictedAccountId, p.annual.restrictedAccountId].some(id => { const a = byId.get(id); return !a?.activeFlag || !a.postingFlag || a.accountType !== "NET_ASSET" || a.normalBalance !== "CREDIT" || a.contraFlag; })) throw new HttpError(409, "Annual closing needs reviewed active net-asset accounts.");
  if (p.annual && (p.mappings.find(m => m.accountId === p.annual?.unrestrictedAccountId)?.netAssetClass !== "UNRESTRICTED" || p.mappings.find(m => m.accountId === p.annual?.restrictedAccountId)?.netAssetClass !== "RESTRICTED")) throw new HttpError(409, "Annual closing targets must match their explicitly approved donor-restriction classes.");
}
export type Cube = Awaited<ReturnType<typeof loadCube>>;
export async function loadCube(tx: Prisma.TransactionClient, q: ReportQuery) {
  const [accounts, groups] = await Promise.all([
    tx.accountingAccount.findMany({ orderBy: [{ code: "asc" }, { id: "asc" }], take: 1001 }),
    tx.$queryRaw<{ accountId: string; fundId: string | null; fundClass: string | null; opening: Prisma.Decimal; debit: Prisma.Decimal; credit: Prisma.Decimal; incomeDebit: Prisma.Decimal; incomeCredit: Prisma.Decimal }[]>(Prisma.sql`
      SELECT l.accounting_account_id AS accountId,l.accounting_fund_id AS fundId,f.fund_class AS fundClass,
      SUM(IF(j.accounting_date<${day(q.from)},l.debit-l.credit,0)) AS opening,
      SUM(IF(j.accounting_date>=${day(q.from)},l.debit,0)) AS debit,SUM(IF(j.accounting_date>=${day(q.from)},l.credit,0)) AS credit,
      SUM(IF(j.accounting_date>=${day(q.from)} AND j.journal_type<>'CLOSING' AND COALESCE(orig.journal_type,'')<>'CLOSING',l.debit,0)) AS incomeDebit,
      SUM(IF(j.accounting_date>=${day(q.from)} AND j.journal_type<>'CLOSING' AND COALESCE(orig.journal_type,'')<>'CLOSING',l.credit,0)) AS incomeCredit
      FROM arya_accounting_journal_line l JOIN arya_accounting_journal j USING(accounting_journal_id) LEFT JOIN arya_accounting_journal orig ON orig.accounting_journal_id=j.reversal_of_journal_id LEFT JOIN arya_accounting_fund f ON f.accounting_fund_id=l.accounting_fund_id
      WHERE j.accounting_date<=${day(q.to)} ${q.accountingFundId ? Prisma.sql`AND l.accounting_fund_id=${q.accountingFundId}` : Prisma.empty} ${q.eventCampaignId ? Prisma.sql`AND l.event_campaign_id=${q.eventCampaignId}` : Prisma.empty}
      GROUP BY l.accounting_account_id,l.accounting_fund_id,f.fund_class ORDER BY l.accounting_account_id,l.accounting_fund_id LIMIT 20001`)
  ]);
  if (accounts.length > 1000 || groups.length > 20000) throw new HttpError(413, "Report scope exceeds bounded account/dimension capacity."); return { accounts, groups };
}
export function netAssetClass(fundClass: string | null, mapped: string | null | undefined) { return fundClass === "DONOR_RESTRICTED" ? "RESTRICTED" : fundClass === "UNRESTRICTED" ? "UNRESTRICTED" : mapped ?? "UNMAPPED"; }
async function cashFlow(tx: Prisma.TransactionClient, q: ReportQuery, policy: ReportingPolicy | null) {
  const maps = new Map(policy?.mappings.map(m => [m.accountId, m]) ?? []), cashIds = [...maps.values()].filter(m => m.cashEquivalent).map(m => m.accountId);
  if (!policy || !cashIds.length) return { status: "PENDING_POLICY", method: policy?.cashFlowMethod ?? null, opening: null, closing: null, netMovement: null, difference: null, activities: null, exceptions: ["Explicit cash-equivalent accounts and DIRECT policy required."], sources: [] };
  const totals = await tx.accountingJournalLine.aggregate({ where: { accountId: { in: cashIds }, journal: { accountingDate: { lt: day(q.from) } }, accountingFundId: q.accountingFundId, eventCampaignId: q.eventCampaignId }, _sum: { debit: true, credit: true } });
  const rows = await tx.accountingJournal.findMany({ where: { accountingDate: { gte: day(q.from), lte: day(q.to) }, lines: { some: { accountId: { in: cashIds }, accountingFundId: q.accountingFundId, eventCampaignId: q.eventCampaignId } } },
    include: { lines: true, relFkAccJournalReversal: { include: { lines: true } } }, orderBy: [{ accountingDate: "asc" }, { id: "asc" }], take: 5001 });
  if (rows.length > 5000) throw new HttpError(413, "Cash-flow drilldown exceeds 5,000 journals; narrow scope.");
  const sourceIds = rows.map(j => j.reversalOfJournalId ?? j.id);
  const settlements = await tx.accountingSettlement.findMany({ where: { postingJournalId: { in: sourceIds } }, include: { revFkAccAllocationSettlement: { include: { relFkAccAllocationDoc: { include: { revFkAccDocLineDoc: true, revFkAccDocAdjustDoc: { include: { relFkAccDocAdjustJournal: { include: { lines: true, revFkAccJournalReversal: true } } } } } } } } } });
  const byJournal = new Map(settlements.map(s => [s.postingJournalId, s])); const amounts = { OPERATING: 0n, INVESTING: 0n, FINANCING: 0n }, exceptions: string[] = [], sources: { journalId: string; cashMovement: string; allocations: { activity: string; amount: string; sourceId: string }[] }[] = [];
  let movement = 0n;
  for (const j of rows) {
    const cash = j.lines.filter(l => cashIds.includes(l.accountId) && (!q.accountingFundId || l.accountingFundId === q.accountingFundId) && (!q.eventCampaignId || l.eventCampaignId === q.eventCampaignId)).reduce((n, l) => n + cents(l.debit) - cents(l.credit), 0n); movement += cash;
    const original = j.relFkAccJournalReversal ?? j, reversed = Boolean(j.reversalOfJournalId), allocations: { activity: string; amount: string; sourceId: string }[] = [];
    if (!cash && j.lines.every(l => cashIds.includes(l.accountId))) { sources.push({ journalId: j.id, cashMovement: "0.00", allocations }); continue; }
    const s = byJournal.get(original.id);
    let classified = 0n;
    if (s) {
      let originalCash = original.lines.filter(l => cashIds.includes(l.accountId)).reduce((n, l) => n + cents(l.debit) - cents(l.credit), 0n);
      if ((reversed ? -originalCash : originalCash) !== cash || (originalCash < 0n ? -originalCash : originalCash) !== cents(s.amount)) exceptions.push(`${j.id}: settlement cash/source mismatch`);
      else for (const a of s.revFkAccAllocationSettlement) {
        const adjustments = a.relFkAccAllocationDoc.revFkAccDocAdjustDoc.filter(x => x.relFkAccDocAdjustJournal.accountingDate <= original.accountingDate && (!x.relFkAccDocAdjustJournal.revFkAccJournalReversal || x.relFkAccDocAdjustJournal.revFkAccJournalReversal.accountingDate > original.accountingDate));
        const activities = new Set([...a.relFkAccAllocationDoc.revFkAccDocLineDoc.map(l => maps.get(l.accountingAccountId)?.cashFlowActivity), ...adjustments.flatMap(x => x.relFkAccDocAdjustJournal.lines.filter(l => l.accountId !== a.relFkAccAllocationDoc.controlAccountId).map(l => maps.get(l.accountId)?.cashFlowActivity))]);
        if (adjustments.length && (activities.size !== 1 || activities.has(null) || activities.has(undefined))) { exceptions.push(`${j.id}: adjusted document has ambiguous mixed-activity cash classification; explicit reviewed allocation required`); continue; }
        const lines = [...a.relFkAccAllocationDoc.revFkAccDocLineDoc].sort((a, b) => a.lineNo - b.lineNo), total = lines.reduce((n, l) => n + cents(l.amount), 0n), amount = cents(a.allocatedAmount), sign = cash < 0n ? -1n : 1n; let allocated = 0n, cumulative = 0n;
        for (const l of lines) { cumulative += cents(l.amount); const next = total ? amount * cumulative / total : 0n, part = (next - allocated) * sign; allocated = next; const target = maps.get(l.accountingAccountId)?.cashFlowActivity;
          if (!target) exceptions.push(`${j.id}: missing source-document cash-flow mapping ${l.accountingAccountId}`); else { amounts[target] += part; classified += part; allocations.push({ activity: target, amount: money(part), sourceId: l.id }); } }
      }
    } else for (const l of j.lines.filter(l => !cashIds.includes(l.accountId))) {
      const value = cents(l.credit) - cents(l.debit), target = maps.get(l.accountId)?.cashFlowActivity;
      if (value && !target) exceptions.push(`${j.id}: unmapped cash counterpart ${l.accountId}`);
      if (target) { amounts[target] += value; classified += value; allocations.push({ activity: target, amount: money(value), sourceId: l.id }); }
    }
    if (classified !== cash) exceptions.push(`${j.id}: unclassified cash movement ${money(cash - classified)}`);
    sources.push({ journalId: j.id, cashMovement: money(cash), allocations });
  }
  const opening = cents(totals._sum.debit ?? "0") - cents(totals._sum.credit ?? "0"), classified = amounts.OPERATING + amounts.INVESTING + amounts.FINANCING;
  return { status: exceptions.length ? "UNVERIFIED" : "VERIFIED", method: "DIRECT", opening: money(opening), closing: money(opening + movement), netMovement: money(movement), difference: money(movement - classified), activities: Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, money(v)])), exceptions, sources };
}
async function buildStatements(tx: Prisma.TransactionClient, q: ReportQuery) {
  const config = await currentPolicy(tx, q.fiscalYearId), { year, policy } = config;
  if (day(q.from) < year.startDate || day(q.to) > year.endDate) throw new HttpError(400, "Report primary scope must be inside its fiscal year.");
  const cube = await loadCube(tx, q), maps = new Map(policy?.mappings.map(m => [m.accountId, m]) ?? []), accountMap = new Map(cube.accounts.map(a => [a.id, a]));
  const exceptions: string[] = policy ? [] : ["PENDING_POLICY: no independently adopted reporting policy for fiscal year."], byAccount = new Map<string, { opening: bigint; debit: bigint; credit: bigint }>();
  const position = { assets: 0n, liabilities: 0n, netAssets: 0n, undistributedSurplus: 0n }, income = new Map<string, bigint>(), revenueCategories = new Map<string, bigint>(), expenseCategories = new Map<string, bigint>(), na: Record<string, { opening: bigint; income: bigint; other: bigint; closing: bigint }> = {};
  let dr = 0n, cr = 0n, periodDr = 0n, periodCr = 0n;
  for (const g of cube.groups) {
    const a = accountMap.get(g.accountId); if (!a) throw new HttpError(409, "Ledger account is missing."); const m = maps.get(a.id), op = cents(g.opening), d = cents(g.debit), c = cents(g.credit), close = op + d - c;
    const prior = byAccount.get(a.id) ?? { opening: 0n, debit: 0n, credit: 0n }; prior.opening += op; prior.debit += d; prior.credit += c; byAccount.set(a.id, prior); dr += op + d; cr += c; periodDr += d; periodCr += c;
    if (!m) exceptions.push(`UNMAPPED_ACCOUNT:${a.id}:${a.code}`);
    if (a.accountType === "ASSET") position.assets += close; if (a.accountType === "LIABILITY") position.liabilities -= close;
    if (a.accountType === "NET_ASSET") position.netAssets -= close;
    const temp = ["REVENUE", "EXPENSE"].includes(a.accountType), inc = temp ? cents(g.incomeCredit) - cents(g.incomeDebit) : 0n;
    if (temp) { position.undistributedSurplus -= close; const category = m?.incomeClass ?? "UNMAPPED"; income.set(category, (income.get(category) ?? 0n) + inc); }
    if (a.accountType === "REVENUE") { const key = m?.incomeClass ?? "UNMAPPED"; revenueCategories.set(key, (revenueCategories.get(key) ?? 0n) + inc); }
    if (a.accountType === "EXPENSE") { const key = m?.incomeClass ?? "UNMAPPED"; expenseCategories.set(key, (expenseCategories.get(key) ?? 0n) - inc); }
    if (temp || a.accountType === "NET_ASSET") {
      const cls = netAssetClass(g.fundClass, m?.netAssetClass); if (cls === "UNMAPPED" && (op || d || c)) exceptions.push(`UNMAPPED_NET_ASSET_CLASS:${a.id}:${g.fundId ?? "none"}`);
      const n = na[cls] ?? { opening: 0n, income: 0n, other: 0n, closing: 0n }; n.opening -= op; n.closing -= close; n.income += inc; if (a.accountType === "NET_ASSET") n.other += cents(g.incomeCredit) - cents(g.incomeDebit); na[cls] = n;
    }
  }
  const rows = cube.accounts.filter(a => a.postingFlag || byAccount.has(a.id)).map(a => { const b = byAccount.get(a.id) ?? { opening: 0n, debit: 0n, credit: 0n }, close = b.opening + b.debit - b.credit; return { ...a, mapping: maps.get(a.id) ?? null, openingDebit: money(b.opening > 0n ? b.opening : 0n), openingCredit: money(b.opening < 0n ? -b.opening : 0n), debit: money(b.debit), credit: money(b.credit), closingDebit: money(close > 0n ? close : 0n), closingCredit: money(close < 0n ? -close : 0n), signedClosingDebit: money(close) }; });
  for (const row of rows) if (!row.mapping && row.activeFlag) exceptions.push(`UNMAPPED_ACTIVE_POSTING_ACCOUNT:${row.id}`);
  const surplus = [...income.values()].reduce((n, v) => n + v, 0n), totalNA = position.netAssets + position.undistributedSurplus, equation = position.assets - position.liabilities - totalNA, flow = await cashFlow(tx, q, policy);
  if (equation) exceptions.push("FINANCIAL_POSITION_EQUATION_DIFFERENCE"); if (dr !== cr) exceptions.push("TRIAL_BALANCE_DIFFERENCE"); if (flow.status !== "VERIFIED") exceptions.push("CASH_FLOW_UNVERIFIED");
  const netAssets = Object.fromEntries(Object.entries(na).map(([k, v]) => [k, { opening: money(v.opening), surplusDeficit: money(v.income), otherMovements: money(v.other), closing: money(v.closing), rollforwardDifference: money(v.closing - v.opening - v.income - v.other) }]));
  if (Object.values(netAssets).some(v => v.rollforwardDifference !== "0.00")) exceptions.push("NET_ASSET_ROLLFORWARD_DIFFERENCE");
  const base = { scope: q, status: exceptions.length ? "UNVERIFIED" : "DRAFT_VERIFIED", official: false, fiscalYearRevision: year.revision, policyId: config.draft?.id ?? null, policyReference: policy?.policyReference ?? null,
    exceptions: [...new Set(exceptions)], trialBalance: { balanced: dr === cr, difference: money(dr - cr), periodDebit: money(periodDr), periodCredit: money(periodCr), rows },
    financialPosition: { assets: money(position.assets), liabilities: money(position.liabilities), permanentNetAssets: money(position.netAssets), undistributedSurplusDeficit: money(position.undistributedSurplus), totalNetAssets: money(totalNA), difference: money(equation), balanced: equation === 0n,
      netAssetClasses: Object.fromEntries(Object.entries(na).map(([k, v]) => [k, money(v.closing)])),
      lines: rows.filter(r => ["ASSET", "LIABILITY", "NET_ASSET"].includes(r.accountType)).map(r => ({ accountId: r.id, section: r.mapping?.section ?? "UNMAPPED", line: r.mapping?.statementLine ?? r.name, amount: money(cents(r.signedClosingDebit) * (r.accountType === "ASSET" ? 1n : -1n)) })), undistributedSurplusLine: { section: "NET_ASSETS", amount: money(position.undistributedSurplus) } },
    comprehensiveIncome: { surplusDeficit: money(surplus), categories: Object.fromEntries([...income].map(([k, v]) => [k, money(v)])), recognizedIncome: money([...revenueCategories.values()].reduce((n, v) => n + v, 0n)), recognizedExpenses: money([...expenseCategories.values()].reduce((n, v) => n + v, 0n)), incomeCategories: Object.fromEntries([...revenueCategories].map(([k, v]) => [k, money(v)])), expenseCategories: Object.fromEntries([...expenseCategories].map(([k, v]) => [k, money(v)])), closingEntriesExcluded: true }, changesInNetAssets: netAssets, cashFlows: flow,
    ledgerFingerprint: await ledgerFingerprint(tx, year.startDate, day(q.to)), basis: "POSTED_GL_ONLY; source subledgers classify/reconcile rather than add report amounts." };
  return base;
}
export async function statementsInTransaction(tx: Prisma.TransactionClient, q: ReportQuery) {
  const base = await buildStatements(tx, q);
  let comparative: Awaited<ReturnType<typeof buildStatements>> | { status: string; exceptions: string[] } | null = null;
  if (q.comparativeFrom && q.comparativeTo) { const prior = await tx.accountingFiscalYear.findFirst({ where: { startDate: { lte: day(q.comparativeFrom) }, endDate: { gte: day(q.comparativeTo) } } });
    comparative = prior ? await buildStatements(tx, { ...q, fiscalYearId: prior.id, from: q.comparativeFrom, to: q.comparativeTo, comparativeFrom: undefined, comparativeTo: undefined }) : { status: "UNVERIFIED", exceptions: ["Comparative fiscal year/policy not available."] }; }
  const comparativeUnverified = comparative && comparative.status !== "DRAFT_VERIFIED";
  return { ...base, comparative, status: comparativeUnverified ? "UNVERIFIED" : base.status, exceptions: comparativeUnverified ? [...base.exceptions, "COMPARATIVE_UNVERIFIED"] : base.exceptions };
}
export const financialStatements = (actor: string, q: ReportQuery) => readAccounting(actor, tx => statementsInTransaction(tx, q));
