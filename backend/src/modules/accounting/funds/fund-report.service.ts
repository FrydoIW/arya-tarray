import { Prisma } from "@prisma/client";
import { aparTransaction } from "../apar/apar.repository.js";
import { requireAccountingPermission } from "../approval/approval.repository.js";
import { cents, money } from "./fund.domain.js";
import { loadFund, loadRestriction, loadDesignation, loadFundDraft, releasedAmount } from "./fund.repository.js";
type Page = { page: number; pageSize: number; status?: string; fundId?: string; search?: string };
const read = <T>(actor: string, work: (tx: Prisma.TransactionClient) => Promise<T>) => aparTransaction(async tx => { await requireAccountingPermission(tx, actor, "ACCOUNTING_REPORT"); return work(tx); });
export function listFunds(actor: string, q: Page) { return read(actor, async tx => {
  const where: Prisma.AccountingFundWhereInput = { status: q.status, ...(q.search ? { OR: [{ fundCode: { contains: q.search } }, { fundName: { contains: q.search } }] } : {}) };
  const [total, rows] = await Promise.all([tx.accountingFund.count({ where }), tx.accountingFund.findMany({ where, orderBy: [{ fundCode: "asc" }, { id: "asc" }], take: q.pageSize, skip: (q.page - 1) * q.pageSize })]);
  return { ...q, total, rows: rows.map(f => ({ ...f, policyStatus: !f.policy || f.fundClass === "CONDITIONAL_REVIEW" ? "PENDING_POLICY" : f.status === "DRAFT" ? "REVIEW_REQUIRED" : "APPROVED_POLICY" })) };
}); }
export function getFundSource(actor: string, type: "FUND" | "RESTRICTION" | "DESIGNATION" | "MOVEMENT", id: string) { return read(actor, async tx => {
  const row = type === "FUND" ? await loadFund(tx, id) : type === "RESTRICTION" ? await loadRestriction(tx, id) : type === "DESIGNATION" ? await loadDesignation(tx, id) : await loadFundDraft(tx, id);
  const [history, releaseSum] = await Promise.all([tx.accountingApprovalRequest.findMany({ where: { sourceDocumentId: id }, orderBy: [{ requestedAt: "desc" }, { id: "desc" }], take: 100,
    include: { history: { orderBy: [{ actionAt: "asc" }, { id: "asc" }], take: 100 } } }), type === "RESTRICTION" ? releasedAmount(tx, id) : Promise.resolve(null)]);
  return { ...row, ...(releaseSum !== null && "originalAmount" in row ? { releasedAmount: money(releaseSum), remainingAmount: money(cents(row.originalAmount) - releaseSum) } : {}), history, historyLimit: 100 };
}); }
export function listFundChildren(actor: string, fundId: string, type: "RESTRICTION" | "DESIGNATION" | "MOVEMENT" | "RELEASE" | "JOURNAL", q: Page) { return read(actor, async tx => {
  await loadFund(tx, fundId);
  const page = { take: q.pageSize, skip: (q.page - 1) * q.pageSize };
  const where = { accountingFundId: fundId, status: q.status };
  if (type === "RESTRICTION") {
    const [total, rows] = await Promise.all([tx.accountingFundRestriction.count({ where }), tx.accountingFundRestriction.findMany({ where, ...page, orderBy: { id: "asc" } })]);
    const released = await tx.accountingFundRelease.groupBy({ by: ["fundRestrictionId"], where: { fundRestrictionId: { in: rows.map(r => r.id) }, activeEvidenceKey: { not: null } }, _sum: { amount: true } }), byId = new Map(released.map(r => [r.fundRestrictionId, cents(r._sum.amount ?? "0")]));
    return { ...q, total, rows: rows.map(r => ({ ...r, releasedAmount: money(byId.get(r.id) ?? 0n), remainingAmount: money(cents(r.originalAmount) - (byId.get(r.id) ?? 0n)) })) };
  }
  if (type === "DESIGNATION") { const [total, rows] = await Promise.all([tx.accountingFundDesignation.count({ where }), tx.accountingFundDesignation.findMany({ where, ...page, orderBy: { id: "asc" } })]); return { ...q, total, rows }; }
  if (type === "MOVEMENT") { const [total, rows] = await Promise.all([tx.accountingJournalDraft.count({ where }), tx.accountingJournalDraft.findMany({ where, ...page, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })]); return { ...q, total, rows }; }
  if (type === "RELEASE") { const w = { relFkAccFundReleaseRestriction: { accountingFundId: fundId } }; const [total, rows] = await Promise.all([tx.accountingFundRelease.count({ where: w }), tx.accountingFundRelease.findMany({ where: w, ...page, orderBy: [{ releaseDate: "desc" }, { id: "desc" }] })]); return { ...q, total, rows }; }
  const w = { lines: { some: { accountingFundId: fundId } } }, [total, rows] = await Promise.all([tx.accountingJournal.count({ where: w }), tx.accountingJournal.findMany({ where: w, ...page, orderBy: [{ accountingDate: "desc" }, { id: "desc" }] })]); return { ...q, total, rows };
}); }
export async function fundMetrics(tx: Prisma.TransactionClient, id: string) {
  const fund = await loadFund(tx, id);
  const [gl, restrictions, release, designations, contributions, relatedExpenses, wallet] = await Promise.all([
    tx.$queryRaw<{ kind: string; net: Prisma.Decimal; cash: Prisma.Decimal }[]>`SELECT a.account_type AS kind,SUM(l.credit-l.debit) AS net,SUM(IF(l.bank_account_id IS NOT NULL AND a.account_type='ASSET' AND a.contra_flag=0,l.debit-l.credit,0)) AS cash FROM arya_accounting_journal_line l JOIN arya_accounting_account a ON a.accounting_account_id=l.accounting_account_id WHERE l.accounting_fund_id=${id} GROUP BY a.account_type`,
    tx.accountingFundRestriction.aggregate({ where: { accountingFundId: id, status: { in: ["ACTIVE", "SATISFIED"] } }, _sum: { originalAmount: true } }),
    tx.accountingFundRelease.aggregate({ where: { relFkAccFundReleaseRestriction: { accountingFundId: id }, activeEvidenceKey: { not: null } }, _sum: { amount: true } }),
    tx.accountingFundDesignation.aggregate({ where: { accountingFundId: id, status: "ACTIVE" }, _sum: { amount: true } }),
    tx.$queryRaw<{ kind: string; accountType: string; amount: Prisma.Decimal }[]>`SELECT j.source_kind AS kind,a.account_type AS accountType,SUM(l.credit) AS amount FROM arya_accounting_journal_line l JOIN arya_accounting_journal j ON j.accounting_journal_id=l.accounting_journal_id JOIN arya_accounting_account a ON a.accounting_account_id=l.accounting_account_id LEFT JOIN arya_accounting_journal r ON r.reversal_of_journal_id=j.accounting_journal_id WHERE l.accounting_fund_id=${id} AND j.source_kind IN ('FUND_CLASSIFY','FUND_OPENING','FUND_RESTRICTION') AND r.accounting_journal_id IS NULL GROUP BY j.source_kind,a.account_type`,
    tx.$queryRaw<{ amount: Prisma.Decimal }[]>`SELECT COALESCE(SUM(r.amount),0) AS amount FROM arya_accounting_fund_release r JOIN arya_accounting_fund_restriction s ON s.fund_restriction_id=r.fund_restriction_id JOIN arya_accounting_journal_line l ON l.accounting_journal_line_id=r.evidence_journal_line_id JOIN arya_accounting_account a ON a.accounting_account_id=l.accounting_account_id WHERE s.accounting_fund_id=${id} AND r.active_evidence_key IS NOT NULL AND a.account_type='EXPENSE'`,
    fund.eventCampaignId ? tx.$queryRaw<{ amount: Prisma.Decimal }[]>`SELECT COALESCE(SUM(amount_delta),0) AS amount FROM arya_member_event_campaign_wallet_ledger WHERE event_campaign_id=${fund.eventCampaignId} AND entry_status='ACTIVE'` : Promise.resolve(null)
  ]);
  const byType = new Map(gl.map(r => [r.kind, cents(r.net)])), netAsset = byType.get("NET_ASSET") ?? 0n, revenue = byType.get("REVENUE") ?? 0n, expense = -(byType.get("EXPENSE") ?? 0n);
  const designated = cents(designations._sum.amount ?? "0"), economic = netAsset + revenue - expense;
  const funded = cents(restrictions._sum.originalAmount ?? "0"), released = cents(release._sum.amount ?? "0");
  return { fundId: id, fundClass: fund.fundClass, scope: "CURRENT_POSTED_GL_INCLUDING_REVERSALS", recognizedContributionClassifications: money(contributions.filter(r => r.kind !== "FUND_OPENING" && r.accountType === "REVENUE").reduce((n, r) => n + cents(r.amount), 0n)),
    classifiedConditionalLiabilityContributions: money(contributions.filter(r => r.accountType === "LIABILITY").reduce((n, r) => n + cents(r.amount), 0n)),
    openingNetAssetClassifications: money(contributions.filter(r => r.kind === "FUND_OPENING").reduce((n, r) => n + cents(r.amount), 0n)),
    accountingNetAssets: money(netAsset), netRevenueIncludingReclassifications: money(revenue), recognizedExpenses: money(expense), economicNetResources: money(economic),
    liabilityControlNet: money(byType.get("LIABILITY") ?? 0n), restrictedOriginalAmount: money(funded), eligibleReleasedAmount: money(released), unreleasedRestrictions: money(funded - released),
    internalDesignations: money(designated), managementAvailableNetResources: fund.fundClass === "UNRESTRICTED" ? money(economic - designated) : null,
    actualFundTaggedBankCash: money(gl.reduce((n, r) => n + cents(r.cash), 0n)), cashAttribution: "Fund reclassification does not retag original bank cash; unassigned cash remains outside this metric.",
    relatedEligibleRecognizedExpenses: money(cents(relatedExpenses[0]?.amount ?? "0")), commitments: null, commitmentStatus: "UNKNOWN_NOT_INFERRED_FROM_SUBSCRIPTIONS_OR_CAMPAIGN_TARGETS",
    campaignWallet: wallet ? money(cents(wallet[0]?.amount ?? "0")) : null, walletScope: "OPERATIONAL_CAMPAIGN_ALL_PARTICIPANTS_NOT_A_FUND_GL_BALANCE" };
}
export const getFundMetrics = (actor: string, id: string) => read(actor, tx => fundMetrics(tx, id));
export function contributionSources(actor: string, q: Page & { unallocatedOnly: boolean }) { return read(actor, async tx => {
  const cte = Prisma.sql`WITH claims AS (
    SELECT source_journal_line_id AS id,original_amount AS amount FROM arya_accounting_fund_restriction WHERE status<>'CANCELLED'
    UNION ALL SELECT fund_source_line_id,CAST(JSON_UNQUOTE(JSON_EXTRACT(fund_metadata,'$.amount')) AS DECIMAL(20,2)) FROM arya_accounting_journal_draft WHERE source_kind='FUND_JOURNAL' AND status<>'CANCELLED'
  ), used AS (SELECT id,SUM(amount) AS amount FROM claims GROUP BY id), sources AS (
    SELECT l.accounting_journal_line_id AS id,l.accounting_journal_id AS journalId,j.source_kind AS sourceKind,j.accounting_date AS accountingDate,
      j.bank_transaction_id AS bankTransactionId,l.event_code_id AS eventCodeId,l.event_campaign_id AS eventCampaignId,l.member_identity_id AS memberIdentityId,l.member_id AS historicalMemberId,
      a.account_type AS accountType,l.credit AS originalAmount,COALESCE(u.amount,0) AS reservedOrClassifiedAmount,l.credit-COALESCE(u.amount,0) AS unallocatedAmount
    FROM arya_accounting_journal_line l JOIN arya_accounting_journal j ON j.accounting_journal_id=l.accounting_journal_id JOIN arya_accounting_account a ON a.accounting_account_id=l.accounting_account_id LEFT JOIN used u ON u.id=l.accounting_journal_line_id
    WHERE l.credit>0 AND l.debit=0 AND l.accounting_fund_id IS NULL AND a.account_type IN ('REVENUE','LIABILITY','NET_ASSET') AND j.journal_type<>'REVERSAL'
      AND j.source_kind NOT IN ('FUND_CLASSIFY','FUND_RESTRICTION','FUND_RELEASE','FUND_OPENING') AND NOT EXISTS(SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id)
  )`;
  const where = q.unallocatedOnly ? Prisma.sql`WHERE unallocatedAmount>0` : Prisma.empty;
  const [count, rows] = await Promise.all([tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`${cte} SELECT COUNT(*) AS total FROM sources ${where}`),
    tx.$queryRaw<{ id: string; originalAmount: Prisma.Decimal; reservedOrClassifiedAmount: Prisma.Decimal; unallocatedAmount: Prisma.Decimal }[]>(Prisma.sql`${cte} SELECT * FROM sources ${where} ORDER BY accountingDate DESC,id ASC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`)]);
  return { ...q, total: Number(count[0]?.total ?? 0n), rows, classificationStatus: "REVIEW_REQUIRED_EXPLICIT_POLICY_AND_SOURCE_EVIDENCE", recognitionCreated: false };
}); }
export function reconcileFund(actor: string, id: string) { return read(actor, async tx => {
  const m = await fundMetrics(tx, id), exceptions: { code: string; reason: string; sourceId?: string }[] = [];
  const fund = await loadFund(tx, id);
  if (!fund.policy || fund.fundClass === "CONDITIONAL_REVIEW") exceptions.push({ code: "PENDING_POLICY", reason: "Recognition/release policy requires an explicit adopted decision." });
  const pending = await tx.accountingJournalDraft.findMany({ where: { accountingFundId: id, sourceKind: "FUND_COMMAND", fundActiveBankId: { not: null }, status: "DRAFT" }, take: 101, orderBy: { id: "asc" } });
  for (const d of pending.slice(0, 100)) exceptions.push({ code: "PENDING_CONDITIONAL_REVIEW", sourceId: d.id, reason: "Bank source held pending policy; no automatic recognition permitted." });
  if (fund.fundClass === "DONOR_RESTRICTED" && m.economicNetResources !== m.unreleasedRestrictions) exceptions.push({ code: "RESTRICTED_GL_DIFFERENCE", reason: `GL net resources ${m.economicNetResources}; remaining donor restrictions ${m.unreleasedRestrictions}. Review direct dimensions, expenses and missing movements.` });
  if (cents(m.internalDesignations) > cents(m.economicNetResources)) exceptions.push({ code: "DESIGNATION_EXCEEDS_RESOURCES", reason: "Management commitments exceed current unrestricted net resources." });
  if (cents(m.unreleasedRestrictions) < 0n) exceptions.push({ code: "OVER_RELEASE", reason: "Active releases exceed funded restrictions." });
  const bad = await tx.$queryRaw<{ id: string; reason: string }[]>`SELECT s.fund_restriction_id AS id,'MISSING_CLASSIFICATION_JOURNAL' AS reason FROM arya_accounting_fund_restriction s LEFT JOIN arya_accounting_journal j ON j.accounting_journal_id=s.classification_journal_id WHERE s.accounting_fund_id=${id} AND s.status IN ('ACTIVE','SATISFIED') AND j.accounting_journal_id IS NULL
    UNION ALL SELECT d.journal_draft_id,'UNLINKED_FUND_MOVEMENT' FROM arya_accounting_journal_draft d LEFT JOIN arya_accounting_journal j ON j.accounting_journal_id=d.posted_journal_id WHERE d.accounting_fund_id=${id} AND d.source_kind='FUND_JOURNAL' AND d.status='POSTED' AND j.accounting_journal_id IS NULL
    UNION ALL SELECT l.accounting_journal_line_id,'UNLINKED_FUND_CLASSIFICATION' FROM arya_accounting_journal_line l JOIN arya_accounting_journal j ON j.accounting_journal_id=l.accounting_journal_id WHERE l.accounting_fund_id=${id} AND l.credit>0 AND j.source_kind IN ('FUND_CLASSIFY','FUND_OPENING') AND NOT EXISTS(SELECT 1 FROM arya_accounting_journal_draft d WHERE d.posted_journal_id=j.accounting_journal_id) LIMIT 101`;
  for (const b of bad.slice(0, 100)) exceptions.push({ code: b.reason, sourceId: b.id, reason: "Persisted movement and actual GL source references differ." });
  const classificationIssues = await tx.$queryRaw<{ id: string; reason: string }[]>`SELECT l.accounting_journal_line_id AS id,'INCORRECT_CLASSIFICATION' AS reason FROM arya_accounting_journal_line l JOIN arya_accounting_journal j ON j.accounting_journal_id=l.accounting_journal_id JOIN arya_accounting_account a ON a.accounting_account_id=l.accounting_account_id JOIN arya_accounting_fund f ON f.accounting_fund_id=l.accounting_fund_id WHERE f.accounting_fund_id=${id} AND l.credit>0 AND j.source_kind IN ('FUND_CLASSIFY','FUND_RESTRICTION') AND ((f.fund_class='CONDITIONAL_LIABILITY' AND a.account_type<>'LIABILITY') OR (f.fund_class IN ('UNRESTRICTED','DONOR_RESTRICTED') AND a.account_type<>'REVENUE'))
    UNION ALL SELECT r.fund_release_id,'RELEASE_ACTIVE_REFERENCE_DIFFERENCE' FROM arya_accounting_fund_release r JOIN arya_accounting_fund_restriction s ON s.fund_restriction_id=r.fund_restriction_id LEFT JOIN arya_accounting_journal rev ON rev.reversal_of_journal_id=r.release_journal_id WHERE s.accounting_fund_id=${id} AND ((r.active_evidence_key IS NULL AND rev.accounting_journal_id IS NULL) OR (r.active_evidence_key IS NOT NULL AND rev.accounting_journal_id IS NOT NULL))
    UNION ALL SELECT d.accounting_journal_line_id,'BANK_SOURCE_CHANGED' FROM arya_accounting_journal_line d JOIN arya_accounting_journal j ON j.accounting_journal_id=d.accounting_journal_id JOIN arya_bank_transaction b ON b.bank_transaction_id=j.bank_transaction_id WHERE d.accounting_fund_id IS NULL AND d.credit>0 AND EXISTS(SELECT 1 FROM arya_accounting_fund_restriction s WHERE s.accounting_fund_id=${id} AND s.source_journal_line_id=d.accounting_journal_line_id AND s.status IN ('ACTIVE','SATISFIED')) AND (b.reconciliation_excluded_at IS NOT NULL OR b.status<>'FINALIZED' OR NOT(b.event_code_id<=>d.event_code_id) OR NOT(b.event_campaign_id<=>d.event_campaign_id)) LIMIT 101`;
  for (const b of classificationIssues.slice(0, 100)) exceptions.push({ code: b.reason, sourceId: b.id, reason: "Stored source classification/reversal or operational bank evidence requires review." });
  const totals = await tx.$queryRaw<{ sourceId: string; used: Prisma.Decimal; capacity: Prisma.Decimal }[]>`WITH claims AS (
    SELECT source_journal_line_id AS sourceId,accounting_fund_id AS fundId,original_amount AS amount FROM arya_accounting_fund_restriction WHERE status<>'CANCELLED'
    UNION ALL SELECT fund_source_line_id,accounting_fund_id,CAST(JSON_UNQUOTE(JSON_EXTRACT(fund_metadata,'$.amount')) AS DECIMAL(20,2)) FROM arya_accounting_journal_draft WHERE source_kind='FUND_JOURNAL' AND status<>'CANCELLED'
  ) SELECT c.sourceId,SUM(c.amount) AS used,MAX(l.credit) AS capacity FROM claims c JOIN arya_accounting_journal_line l ON l.accounting_journal_line_id=c.sourceId WHERE c.sourceId IN(SELECT sourceId FROM claims WHERE fundId=${id}) GROUP BY c.sourceId HAVING SUM(c.amount)>MAX(l.credit) LIMIT 101`;
  for (const t of totals.slice(0, 100)) exceptions.push({ code: "DUPLICATE_SOURCE_NOMINAL", sourceId: t.sourceId, reason: `Claims ${t.used}; actual source ${t.capacity}.` });
  const evidenceTotals = await tx.$queryRaw<{ id: string }[]>`SELECT r.evidence_journal_line_id AS id FROM arya_accounting_fund_release r JOIN arya_accounting_journal_line l ON l.accounting_journal_line_id=r.evidence_journal_line_id WHERE r.active_evidence_key IS NOT NULL AND r.evidence_journal_line_id IN(SELECT e.evidence_journal_line_id FROM arya_accounting_fund_release e JOIN arya_accounting_fund_restriction s ON s.fund_restriction_id=e.fund_restriction_id WHERE s.accounting_fund_id=${id}) GROUP BY r.evidence_journal_line_id HAVING SUM(r.amount)>MAX(l.debit) LIMIT 101`;
  for (const e of evidenceTotals.slice(0, 100)) exceptions.push({ code: "EVIDENCE_OVER_RELEASE", sourceId: e.id, reason: "Active releases across restrictions exceed the real recognized expense/capital debit." });
  const unclassified = await tx.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM arya_accounting_journal_line l JOIN arya_accounting_account a ON a.accounting_account_id=l.accounting_account_id JOIN arya_accounting_journal j ON j.accounting_journal_id=l.accounting_journal_id WHERE a.account_type='REVENUE' AND l.credit>0 AND l.accounting_fund_id IS NULL AND j.source_kind='FINALIZED_BANK_TRANSACTION' AND NOT EXISTS(SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id) AND NOT EXISTS(SELECT 1 FROM arya_accounting_fund_restriction s WHERE s.source_journal_line_id=l.accounting_journal_line_id AND s.status IN ('ACTIVE','SATISFIED')) AND NOT EXISTS(SELECT 1 FROM arya_accounting_journal_draft d WHERE d.fund_source_line_id=l.accounting_journal_line_id AND d.status='POSTED')`;
  if (Number(unclassified[0]?.total)) exceptions.push({ code: "GLOBAL_UNCLASSIFIED_CONTRIBUTIONS", reason: `${unclassified[0]?.total} actual bank revenue sources have no financial fund classification; no fund is inferred.` });
  if (m.campaignWallet !== null) exceptions.push({ code: "OPERATIONAL_SCOPE_DIFFERENCE", reason: "Campaign wallet and target are operational evidence, cover different participants/time and cannot be substituted for GL resources/cash." });
  const reviewRequests = await tx.accountingApprovalRequest.findMany({ where: { requestKind: "FUND_RELEASE", restriction: { accountingFundId: id }, status: { in: ["REJECTED", "SUPERSEDED"] } }, select: { id: true, sourceDocumentId: true, status: true, decisionRemark: true }, take: 100, orderBy: { requestedAt: "desc" } });
  return { metrics: m, exceptions, reviewRequests, reviewRequestsLimit: 100, invalidAttemptHandling: "Invalid/duplicate proposals return 409 before persistence; valid request decisions remain in approval history.", exceptionsTruncated: pending.length > 100 || bad.length > 100 || totals.length > 100 || classificationIssues.length > 100 || evidenceTotals.length > 100, automaticAdjustments: false, status: exceptions.length ? "REVIEW_REQUIRED" : "RECONCILED" };
}); }
