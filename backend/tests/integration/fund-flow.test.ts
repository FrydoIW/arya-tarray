import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma.js";
import { fundScenario, type FundFixture } from "./fund-fixture.js";
import { createFund, createRestriction, reviseFund, reviseRestriction, createDesignation, createFundCommand, createFundMovement, cancelFundDraft } from "../../src/modules/accounting/funds/fund.service.js";
import { fundCommandSchema } from "../../src/modules/accounting/funds/fund.schema.js";
import { getFundMetrics, reconcileFund, getFundSource, listFundChildren } from "../../src/modules/accounting/funds/fund-report.service.js";
import { applyApprovedAction, createDraft, decideApproval, getApproval, postApprovedJournal, postApprovedJournalInTransaction, submitApproval } from "../../src/modules/accounting/approval/approval.service.js";
import { postStatementRecognition } from "../../src/modules/accounting/accounting.posting.js";
import { decideSignApprovalAtomic } from "../../src/modules/approval/sign-approval/sign-approval.repository.js";
import { createSettlement } from "../../src/modules/accounting/apar/apar.service.js";
import { createAsset, createCategory } from "../../src/modules/accounting/assets/asset.service.js";
import { contributionSources } from "../../src/modules/accounting/funds/fund-report.service.js";
import jwt from "jsonwebtoken";
async function example(f: FundFixture, amount = "20000000.00") {
  const restricted = await f.fund("DONOR_RESTRICTED"), target = await f.fund(), source = await f.manual(amount), restriction = await f.restrict(restricted.row.id, source.line.id, amount);
  return { restricted, target, source, restriction };
}
async function global(f: FundFixture) {
  const lines = await prisma.accountingJournalLine.findMany({ where: { journal: { postedById: { in: f.approval.actorIds } } }, include: { account: true } });
  return { revenue: lines.filter(l => l.account.accountType === "REVENUE").reduce((n, l) => n.plus(l.credit).minus(l.debit), new (await import("@prisma/client")).Prisma.Decimal(0)).toFixed(2),
    bank: lines.filter(l => l.accountId === f.bankGl).reduce((n, l) => n.plus(l.debit).minus(l.credit), new (await import("@prisma/client")).Prisma.Decimal(0)).toFixed(2) };
}
async function command(f: FundFixture, fund: string, raw: unknown, apply = true) {
  const d = await createFundCommand(f.actor, fund, fundCommandSchema.parse(raw)), req = await submitApproval(f.actor, { kind: "FUND_COMMAND", sourceDocumentId: d.id, expectedRevision: 1 }); await f.approve(req.id);
  if (apply) await applyApprovedAction(f.poster, req.id); return { d, req };
}
const cmd = { accountingDate: "2026-11-04", reason: "Synthetic TEST independently reviewed policy/management change" };

test("Fund unrestricted classification uses original GL credit, exact dimensions and no second cash/revenue", async () => fundScenario(async f => {
  const fund = await f.fund(), source = await f.manual(); await f.classify(fund.row.id, source.line.id);
  const m = await getFundMetrics(f.actor, fund.row.id); assert.equal(m.recognizedContributionClassifications, "20000000.00"); assert.equal(m.economicNetResources, "20000000.00"); assert.equal(m.actualFundTaggedBankCash, "0.00");
  assert.deepEqual(await global(f), { revenue: "20000000.00", bank: "20000000.00" }); assert.equal((await reconcileFund(f.actor, fund.row.id)).status, "RECONCILED");
}));
test("Purpose restriction records original 20m, donor evidence and one classification journal", async () => fundScenario(async f => {
  const x = await example(f), m = await getFundMetrics(f.actor, x.restricted.row.id); assert.equal(m.unreleasedRestrictions, "20000000.00"); assert.equal(m.economicNetResources, "20000000.00");
  const row = await prisma.accountingFundRestriction.findUniqueOrThrow({ where: { id: x.restriction.r.id } }); assert.equal(row.classificationJournalId, x.restriction.journal?.id);
  assert.equal((await reconcileFund(f.actor, x.restricted.row.id)).status, "RECONCILED");
}));
test("Fund partial 7m and full 13m releases leave 13m then zero, with balanced GL and no new donation", async () => fundScenario(async f => {
  const x = await example(f), expense = await f.manual("7000000.00", f.revenue, x.target.row.id, true), first = await f.release(x.restriction.r.id, f.releaseInput(x.target.row.id, expense.line.id));
  assert.ok(first.journal); assert.equal(first.journal.lines[0]?.debit.toFixed(2), "7000000.00"); assert.equal(first.journal.lines[1]?.credit.toFixed(2), "7000000.00");
  let m = await getFundMetrics(f.actor, x.restricted.row.id); assert.equal(m.unreleasedRestrictions, "13000000.00"); assert.equal(m.economicNetResources, "13000000.00");
  assert.equal((await getFundMetrics(f.actor, x.target.row.id)).economicNetResources, "0.00");
  const rest = await f.manual("13000000.00", f.revenue, x.target.row.id, true); await f.release(x.restriction.r.id, f.releaseInput(x.target.row.id, rest.line.id, "13000000.00"));
  m = await getFundMetrics(f.actor, x.restricted.row.id); assert.equal(m.unreleasedRestrictions, "0.00"); assert.equal(m.eligibleReleasedAmount, "20000000.00"); assert.equal(m.economicNetResources, "0.00");
  assert.equal((await prisma.accountingFundRestriction.findUniqueOrThrow({ where: { id: x.restriction.r.id } })).status, "SATISFIED"); assert.deepEqual(await global(f), { revenue: "20000000.00", bank: "20000000.00" });
  assert.equal((await reconcileFund(f.actor, x.restricted.row.id)).status, "RECONCILED");
}));
test("Time-only release needs elapsed donor date and explicit reviewed evidence, no expense inference", async () => fundScenario(async f => {
  const r = await f.fund("DONOR_RESTRICTED"), u = await f.fund(), source = await f.manual(), restriction = await f.restrict(r.row.id, source.line.id, "20000000.00", v => { v.restrictionKind = "TIME"; v.purposeText = null; v.releaseOn = "2026-11-06"; v.criteria.purposeCriterion = "TIME_ONLY"; });
  await assert.rejects(f.release(restriction.r.id, f.releaseInput(u.row.id, null)), /Time/);
  const input = f.releaseInput(u.row.id, null); input.accountingDate = "2026-11-06"; input.satisfactionDate = "2026-11-06"; await f.release(restriction.r.id, input);
  assert.equal((await getFundMetrics(f.actor, r.row.id)).unreleasedRestrictions, "13000000.00");
}));
test("Future donor satisfaction cannot be manufactured by choosing a future accounting date", async () => fundScenario(async f => {
  const x = await example(f), e = await f.manual("7000000.00", f.revenue, x.target.row.id, true), input = f.releaseInput(x.target.row.id, e.line.id);
  input.satisfactionDate = "2099-01-01"; input.accountingDate = "2099-01-01";
  await assert.rejects(f.release(x.restriction.r.id, input), /future/); assert.equal(await prisma.accountingFundRelease.count(), 0); assert.equal((await getFundMetrics(f.actor, x.restricted.row.id)).unreleasedRestrictions, "20000000.00");
}));
test("Multiple restrictions split one donation nominal; BOTH terms cannot multiply the 20m source", async () => fundScenario(async f => {
  const r = await f.fund("DONOR_RESTRICTED"), source = await f.manual();
  await f.restrict(r.row.id, source.line.id, "12000000.00", v => { v.restrictionKind = "BOTH"; v.releaseOn = "2026-11-15"; }); await f.restrict(r.row.id, source.line.id, "8000000.00");
  await assert.rejects(f.restrict(r.row.id, source.line.id, "0.01"), /capacity/); assert.equal((await getFundMetrics(f.actor, r.row.id)).restrictedOriginalAmount, "20000000.00");
  assert.deepEqual(await global(f), { revenue: "20000000.00", bank: "20000000.00" });
}));
test("Internal designation request/approval/adjustment/release is management-only and audited", async () => fundScenario(async f => {
  const u = await f.fund(), source = await f.manual(); await f.classify(u.row.id, source.line.id);
  const d = await createDesignation(f.actor, u.row.id, { designationReference: randomUUID(), purposeText: "Synthetic TEST board education designation", amount: "10000000.00", effectiveOn: "2026-11-04" }); assert.equal(d.approvedById, null);
  const req = await submitApproval(f.actor, { kind: "FUND_DESIGNATION", sourceDocumentId: d.id, expectedRevision: 1 }); await f.approve(req.id); const journals = await prisma.accountingJournal.count(); await applyApprovedAction(f.poster, req.id);
  assert.equal((await getFundMetrics(f.actor, u.row.id)).managementAvailableNetResources, "10000000.00");
  await command(f, u.row.id, { ...cmd, action: "DESIGNATION_ADJUST", sourceReference: randomUUID(), designationId: d.id, amount: "6000000.00", purposeText: "Synthetic TEST revised internal allocation" });
  assert.equal((await getFundMetrics(f.actor, u.row.id)).internalDesignations, "6000000.00");
  await command(f, u.row.id, { ...cmd, action: "DESIGNATION_RELEASE", sourceReference: randomUUID(), designationId: d.id });
  assert.equal((await getFundMetrics(f.actor, u.row.id)).internalDesignations, "0.00"); assert.equal(await prisma.accountingJournal.count(), journals);
}));
test("Designation cannot use donor-restricted resources or exceed actual unrestricted GL", async () => fundScenario(async f => {
  const x = await example(f), input = { designationReference: randomUUID(), purposeText: "Synthetic TEST unsupported internal allocation", amount: "1.00", effectiveOn: "2026-11-04" };
  await assert.rejects(createDesignation(f.actor, x.restricted.row.id, input)); await assert.rejects(createDesignation(f.actor, x.target.row.id, input)); assert.equal(await prisma.accountingFundDesignation.count(), 0);
}));
test("Over-release and wrong bank/payment evidence are rejected without changes", async () => fundScenario(async f => {
  const x = await example(f), e = await f.manual("21000000.00", f.revenue, x.target.row.id, true);
  await assert.rejects(f.release(x.restriction.r.id, f.releaseInput(x.target.row.id, e.line.id, "21000000.00")), /capacity/);
  await assert.rejects(f.release(x.restriction.r.id, f.releaseInput(x.target.row.id, x.source.line.id)), /Evidence/);
  assert.equal(await prisma.accountingFundRelease.count(), 0); assert.equal((await getFundMetrics(f.actor, x.restricted.row.id)).unreleasedRestrictions, "20000000.00");
}));
test("Duplicate evidence cannot be renamed to release twice; source expense use is globally capped", async () => fundScenario(async f => {
  const x = await example(f), e = await f.manual("10000000.00", f.revenue, x.target.row.id, true); await f.release(x.restriction.r.id, f.releaseInput(x.target.row.id, e.line.id));
  await assert.rejects(f.release(x.restriction.r.id, f.releaseInput(x.target.row.id, e.line.id, "1000000.00")), /already/);
  const source = await f.manual(), second = await f.restrict(x.restricted.row.id, source.line.id);
  await assert.rejects(f.release(second.r.id, f.releaseInput(x.target.row.id, e.line.id, "4000000.00")), /capacity/);
  assert.equal(await prisma.accountingFundRelease.count(), 1);
}));
test("Expense charged directly to restricted fund cannot serve as unrestricted release evidence", async () => fundScenario(async f => {
  const x = await example(f), e = await f.manual("7000000.00", f.revenue, x.restricted.row.id, true);
  await assert.rejects(f.release(x.restriction.r.id, f.releaseInput(x.target.row.id, e.line.id)), /Evidence/);
  assert.ok((await reconcileFund(f.actor, x.restricted.row.id)).exceptions.some(e => e.code === "RESTRICTED_GL_DIFFERENCE"));
}));
test("Stale fund setup and changed restriction approvals cannot be approved/posted", async () => fundScenario(async f => {
  const fund = await f.fund("UNRESTRICTED", false), req = await submitApproval(f.actor, { kind: "FUND_SETUP", sourceDocumentId: fund.row.id, expectedRevision: 1 });
  await reviseFund(f.actor, fund.row.id, 1, { ...fund.input, fundName: "Synthetic revised fund" }); await assert.rejects(f.approve(req.id)); assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: req.id } })).status, "SUPERSEDED");
  const r = await f.fund("DONOR_RESTRICTED"), source = await f.manual(), restriction = await f.restrict(r.row.id, source.line.id, "20000000.00", undefined, false);
  await reviseRestriction(f.actor, restriction.r.id, 1, { ...restriction.input, originalAmount: "19000000.00" }); await assert.rejects(postApprovedJournal(f.poster, restriction.req.id));
}));
test("Self-approval and unauthorized fund posting/revision fail with no journal", async () => fundScenario(async f => {
  const u = await f.fund("UNRESTRICTED", false), req = await submitApproval(f.actor, { kind: "FUND_SETUP", sourceDocumentId: u.row.id, expectedRevision: 1 });
  await assert.rejects(decideApproval(f.actor, req.id, "APPROVED", null), /Requester|authorized/); await f.approve(req.id);
  await assert.rejects(applyApprovedAction(f.approval.outsiderId, req.id), /denied|permission/); assert.equal((await prisma.accountingFund.findUniqueOrThrow({ where: { id: u.row.id } })).status, "DRAFT");
  await assert.rejects(createFund(f.approval.outsiderId, u.input));
}));
test("Concurrent release attempts have one winner, one immutable release journal and exact remainder", async () => fundScenario(async f => {
  const x = await example(f), e = await f.manual("15000000.00", f.revenue, x.target.row.id, true), a = await f.release(x.restriction.r.id, f.releaseInput(x.target.row.id, e.line.id, "15000000.00"), false);
  const results = await Promise.allSettled([postApprovedJournal(f.poster, a.req.id), postApprovedJournal(f.poster, a.req.id)]); assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await prisma.accountingFundRelease.count(), 1); assert.equal((await getFundMetrics(f.actor, x.restricted.row.id)).unreleasedRestrictions, "5000000.00");
}));
test("Two independently approved concurrent releases cannot overdraw donor balance", async () => fundScenario(async f => {
  const x = await example(f), a = await f.manual("15000000.00", f.revenue, x.target.row.id, true), b = await f.manual("15000000.00", f.revenue, x.target.row.id, true);
  const ra = await f.release(x.restriction.r.id, f.releaseInput(x.target.row.id, a.line.id, "15000000.00"), false), rb = await f.release(x.restriction.r.id, f.releaseInput(x.target.row.id, b.line.id, "15000000.00"), false);
  const results = await Promise.allSettled([postApprovedJournal(f.poster, ra.req.id), postApprovedJournal(f.poster, rb.req.id)]); assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal((await getFundMetrics(f.actor, x.restricted.row.id)).unreleasedRestrictions, "5000000.00");
}));
test("CLOSED period blocks approved fund release and leaves approval unconsumed", async () => fundScenario(async f => {
  const x = await example(f), e = await f.manual("7000000.00", f.revenue, x.target.row.id, true), r = await f.release(x.restriction.r.id, f.releaseInput(x.target.row.id, e.line.id), false), period = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: "2026-11" } });
  try { await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: "CLOSED", closedAt: new Date() } }); await assert.rejects(postApprovedJournal(f.poster, r.req.id), /open/i); assert.equal(await prisma.accountingFundRelease.count(), 0); assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: r.req.id } })).status, "APPROVED"); }
  finally { await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: period.status, closedAt: period.closedAt } }); }
}));
test("Approved release reversal restores remainder, keeps original evidence and permits corrected new reference", async () => fundScenario(async f => {
  const x = await example(f), e = await f.manual("7000000.00", f.revenue, x.target.row.id, true), r = await f.release(x.restriction.r.id, f.releaseInput(x.target.row.id, e.line.id)); assert.ok(r.journal);
  await assert.rejects(f.reverse(e.journal.id), /dependent/); await assert.rejects(f.reverse(x.restriction.journal?.id ?? ""), /releases/);
  const rev = await f.reverse(r.journal.id); assert.equal(rev.reversalOfJournalId, r.journal.id); const prior = await prisma.accountingFundRelease.findFirstOrThrow(); assert.equal(prior.activeEvidenceKey, null); assert.ok(prior.evidenceKey);
  assert.equal((await getFundMetrics(f.actor, x.restricted.row.id)).unreleasedRestrictions, "20000000.00");
  const correction = f.releaseInput(x.target.row.id, e.line.id); correction.accountingDate = "2026-11-06"; await f.release(x.restriction.r.id, correction); assert.equal(await prisma.accountingFundRelease.count(), 2);
}));
test("Classification and source reversal preserve original posted records and dependency sequence", async () => fundScenario(async f => {
  const x = await example(f); await assert.rejects(f.reverse(x.source.journal.id), /dependent/); assert.ok(x.restriction.journal); await f.reverse(x.restriction.journal.id);
  assert.equal((await prisma.accountingFundRestriction.findUniqueOrThrow({ where: { id: x.restriction.r.id } })).status, "DRAFT");
  assert.equal((await getFundMetrics(f.actor, x.restricted.row.id)).economicNetResources, "0.00");
  await cancelFundDraft(f.actor, "RESTRICTION", x.restriction.r.id, 2, "Synthetic TEST cancelled source correction"); await f.reverse(x.source.journal.id); assert.deepEqual(await global(f), { revenue: "0.00", bank: "0.00" });
  const history = await getApproval(f.actor, x.restriction.req.id); assert.equal(history.status, "APPLIED"); assert.ok(history.requestPayload); assert.ok(history.source);
}));
test("Donor restrictions cannot be treated as liabilities solely from fund labels", async () => fundScenario(async f => {
  const bad = await f.fund("DONOR_RESTRICTED", false, v => { if (v.policy) v.policy.contributionAccountId = f.apControl; });
  await assert.rejects(submitApproval(f.actor, { kind: "FUND_SETUP", sourceDocumentId: bad.row.id, expectedRevision: 1 }), /classification/);
  const conditional = await f.fund("CONDITIONAL_LIABILITY", false, v => { if (v.policy) v.policy.conditionalObligationEvidence = null; }); await assert.rejects(submitApproval(f.actor, { kind: "FUND_SETUP", sourceDocumentId: conditional.row.id, expectedRevision: 1 }), /obligation/);
}));
test("Conditional PENDING_POLICY persists evidence and atomically blocks bank finalization/recognition", async () => fundScenario(async f => {
  const pending = await f.fund("CONDITIONAL_REVIEW", false), bank = await f.bankSource("STANDARD", "20000000.00", false);
  const hold = await createFundCommand(f.actor, pending.row.id, fundCommandSchema.parse({ ...cmd, action: "CONDITIONAL_REVIEW", sourceReference: randomUUID(), bankTransactionId: bank.transactionId, policyEvidence: "Synthetic TEST unresolved refund/performance donor conditions" }));
  await assert.rejects(submitApproval(f.actor, { kind: "FUND_SETUP", sourceDocumentId: pending.row.id, expectedRevision: 1 }), /PENDING_POLICY/);
  assert.ok(bank.approvalId); await assert.rejects(decideSignApprovalAtomic({ approvalId: bank.approvalId, userId: f.actor, decision: "APPROVED" }), /REVIEW_REQUIRED/);
  assert.equal((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: bank.transactionId } })).status, "CHECK"); assert.equal(await prisma.accountingJournal.count(), 0);
  assert.ok((await reconcileFund(f.actor, pending.row.id)).exceptions.some(e => e.code === "PENDING_CONDITIONAL_REVIEW")); assert.equal(hold.fundActiveBankId, bank.transactionId);
}));
test("Conditional liability resolution binds actual bank/GL evidence without new cash or Phase1 revenue", async () => fundScenario(async f => {
  const pending = await f.fund("CONDITIONAL_REVIEW", false), target = await f.fund("CONDITIONAL_LIABILITY"), bank = await f.bankSource("STANDARD", "20000000.00", false);
  const hold = await createFundCommand(f.actor, pending.row.id, fundCommandSchema.parse({ ...cmd, action: "CONDITIONAL_REVIEW", sourceReference: randomUUID(), bankTransactionId: bank.transactionId, policyEvidence: "Synthetic TEST donor substantive obligation evidence" }));
  const source = await f.manual("20000000.00", f.apControl);
  await command(f, target.row.id, { ...cmd, action: "RESOLVE_CONDITIONAL", sourceReference: randomUUID(), parentId: hold.id, bankTransactionId: bank.transactionId, sourceJournalLineId: source.line.id, policyEvidence: "Synthetic TEST adopted recognition liability policy" });
  assert.ok(bank.approvalId); await decideSignApprovalAtomic({ approvalId: bank.approvalId, userId: f.actor, decision: "APPROVED" });
  assert.equal(await prisma.accountingJournal.count(), 1); await f.classify(target.row.id, source.line.id);
  const conditionalMetrics = await getFundMetrics(f.actor, target.row.id); assert.equal(conditionalMetrics.liabilityControlNet, "20000000.00"); assert.equal(conditionalMetrics.classifiedConditionalLiabilityContributions, "20000000.00"); assert.equal(conditionalMetrics.recognizedContributionClassifications, "0.00"); assert.deepEqual(await global(f), { revenue: "0.00", bank: "20000000.00" });
  await assert.rejects(f.reverse(source.journal.id), /dependent/);
  const cp = await f.counterparty("RECEIVABLE"), doc = await f.document("RECEIVABLE", cp, "20000000.00");
  await assert.rejects(createSettlement(f.actor, "RECEIVABLE", f.settlementInput(cp, [{ accountingDocumentId: doc.document.id, allocatedAmount: "20000000.00" }], "20000000.00", bank.transactionId)), /conditional|reserved/);
}));
for (const type of ["STANDARD", "TIME_BASED", "CAMPAIGN"]) test(`Fund ${type} integration preserves Phase1 bank recognition, identity and no future AR/revenue`, async () => fundScenario(async f => {
  const bank = await f.bankSource(type); assert.ok(bank.line && bank.journal); const original = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: bank.transactionId } });
  const fund = await f.fund(type === "STANDARD" ? "DONOR_RESTRICTED" : "UNRESTRICTED", true, v => { if (type === "CAMPAIGN") v.eventCampaignId = original.eventCampaignId; });
  if (type === "STANDARD") await f.restrict(fund.row.id, bank.line.id); else await f.classify(fund.row.id, bank.line.id);
  await prisma.$transaction(tx => postStatementRecognition(tx, bank.statementId, f.actor, new Date()), { isolationLevel: "Serializable" });
  const after = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: bank.transactionId } }); assert.equal(after.memberIdentityId, original.memberIdentityId); assert.equal(after.eventCampaignId, original.eventCampaignId);
  assert.equal(await prisma.accountingDocument.count(), 0); assert.equal(await prisma.accountingJournal.count({ where: { sourceKind: "FINALIZED_BANK_TRANSACTION" } }), 1); assert.deepEqual(await global(f), { revenue: "20000000.00", bank: "20000000.00" });
  const m = await getFundMetrics(f.actor, fund.row.id); assert.equal(m.recognizedContributionClassifications, "20000000.00"); assert.equal(m.commitments, null); if (type === "CAMPAIGN") assert.equal(m.campaignWallet, "0.00");
}));
test("Fund transaction rollback removes GL, release, history apply and leaves approval available", async () => fundScenario(async f => {
  const x = await example(f), e = await f.manual("7000000.00", f.revenue, x.target.row.id, true), r = await f.release(x.restriction.r.id, f.releaseInput(x.target.row.id, e.line.id), false), count = await prisma.accountingJournal.count();
  await assert.rejects(prisma.$transaction(async tx => { await postApprovedJournalInTransaction(tx, f.poster, r.req.id); throw Error("Synthetic downstream failure"); }, { isolationLevel: "Serializable", timeout: 30000 }), /downstream/);
  assert.equal(await prisma.accountingJournal.count(), count); assert.equal(await prisma.accountingFundRelease.count(), 0); assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: r.req.id } })).status, "APPROVED");
  assert.equal(await prisma.accountingApprovalHistory.count({ where: { approvalRequestId: r.req.id, action: "APPLY" } }), 0);
}));
test("Prospective donor term adjustment supersedes old release approval and retains historical evidence", async () => fundScenario(async f => {
  const x = await example(f), e = await f.manual("7000000.00", f.revenue, x.target.row.id, true), release = await f.release(x.restriction.r.id, f.releaseInput(x.target.row.id, e.line.id), false);
  await command(f, x.restricted.row.id, { ...cmd, action: "AMEND_TERMS", sourceReference: randomUUID(), restrictionId: x.restriction.r.id, purposeText: "Synthetic TEST donor clarified education criterion", releaseOn: null, termsEvidence: "Synthetic TEST signed prospective amendment", criteria: { purposeCriterion: "EXPENSE_INCURRED", eligibilityTerms: "Synthetic TEST revised signed donor eligibility", termsEffectiveOn: "2026-11-04" } });
  await assert.rejects(postApprovedJournal(f.poster, release.req.id), /match|version|independent/); assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: release.req.id } })).status, "SUPERSEDED"); const detail = await getFundSource(f.actor, "RESTRICTION", x.restriction.r.id); assert.ok(detail.history.length);
  const next = f.releaseInput(x.target.row.id, e.line.id); await f.release(x.restriction.r.id, next, true, 2); assert.equal((await getFundMetrics(f.actor, x.restricted.row.id)).unreleasedRestrictions, "13000000.00");
}));
test("Fund register lifecycle and paginated movement/journal history use real approval evidence", async () => fundScenario(async f => {
  const u = await f.fund(), s = await f.manual(); await f.classify(u.row.id, s.line.id);
  await command(f, u.row.id, { ...cmd, action: "CLOSE", sourceReference: randomUUID() }); await assert.rejects(f.classify(u.row.id, s.line.id, "1.00"), /active/);
  await command(f, u.row.id, { ...cmd, action: "REOPEN", sourceReference: randomUUID() });
  const movements = await listFundChildren(f.actor, u.row.id, "MOVEMENT", { page: 1, pageSize: 1 }); assert.equal(movements.total, 3); assert.equal(movements.rows.length, 1);
  const journals = await listFundChildren(f.actor, u.row.id, "JOURNAL", { page: 1, pageSize: 10 }); assert.equal(journals.total, 1);
}));
test("Fund rejection/cancellation and duplicate posting never consume source twice", async () => fundScenario(async f => {
  const u = await f.fund(), s = await f.manual(), d = await createFundMovement(f.actor, u.row.id, { action: "CLASSIFY", sourceJournalLineId: s.line.id, amount: "20000000.00", accountingDate: "2026-11-03", sourceReference: randomUUID(), reason: "Synthetic TEST proposed classification rejected" });
  const req = await submitApproval(f.actor, { kind: "FUND_JOURNAL", sourceDocumentId: d.id, expectedRevision: 1 }); await decideApproval(f.reviewer, req.id, "REJECTED", "Synthetic TEST evidence rejected"); await assert.rejects(postApprovedJournal(f.poster, req.id));
  await cancelFundDraft(f.actor, "MOVEMENT", d.id, 1, "Synthetic TEST cancelled rejected classification"); const replacement = await f.classify(u.row.id, s.line.id); await assert.rejects(postApprovedJournal(f.poster, replacement.req.id));
  const audit = await prisma.accountingJournalDraft.findFirstOrThrow({ where: { sourceKind: "FUND_AUDIT", accountingFundId: u.row.id } }); assert.equal(audit.description, "Synthetic TEST cancelled rejected classification"); assert.equal(audit.postedJournalId, null); assert.ok(audit.fundMetadata);
  assert.equal((await getFundMetrics(f.actor, u.row.id)).recognizedContributionClassifications, "20000000.00");
}));

test("Explicit net-assets release mapping moves actual net assets and never invents a closing balance", async () => fundScenario(async f => {
  const naRestricted = await f.account("NET_ASSET", "CREDIT"), naUnrestricted = await f.account("NET_ASSET", "CREDIT");
  const r = await f.fund("DONOR_RESTRICTED", true, v => { v.balanceAccountId = naRestricted; if (v.policy) v.policy.release = { mode: "NET_ASSET_RECLASSIFICATION", debitAccountId: naRestricted, creditAccountId: naUnrestricted }; });
  const u = await f.fund("UNRESTRICTED", true, v => { v.balanceAccountId = naUnrestricted; }), s = await f.manual(), restriction = await f.restrict(r.row.id, s.line.id), e = await f.manual("7000000.00", f.revenue, u.row.id, true);
  await assert.rejects(f.release(restriction.r.id, f.releaseInput(u.row.id, e.line.id)), /capacity/);
  const draft = await createDraft(f.actor, { journalType: "MANUAL", accountingDate: "2026-11-03", sourceReference: randomUUID(), description: "Synthetic TEST already authorized net asset transfer evidence",
    lines: [{ accountId: f.revenue, debit: "20000000.00", credit: "0.00", accountingFundId: r.row.id, fundRestrictionId: restriction.r.id }, { accountId: naRestricted, debit: "0.00", credit: "20000000.00", accountingFundId: r.row.id, fundRestrictionId: restriction.r.id }] });
  const req = await submitApproval(f.actor, { kind: "MANUAL_JOURNAL", sourceDocumentId: draft.id, expectedRevision: 1 }); await f.approve(req.id); await postApprovedJournal(f.poster, req.id);
  await f.release(restriction.r.id, f.releaseInput(u.row.id, e.line.id)); const m = await getFundMetrics(f.actor, r.row.id); assert.equal(m.accountingNetAssets, "13000000.00"); assert.equal(m.unreleasedRestrictions, "13000000.00");
  assert.equal((await getFundMetrics(f.actor, u.row.id)).accountingNetAssets, "7000000.00"); assert.equal((await getFundMetrics(f.actor, u.row.id)).economicNetResources, "0.00");
}));
test("Capital donor eligibility requires an independently activated Stage2.4 asset and actual source debit", async () => fundScenario(async f => {
  const r = await f.fund("DONOR_RESTRICTED"), u = await f.fund(), s = await f.manual(), restriction = await f.restrict(r.row.id, s.line.id, "20000000.00", v => { v.criteria.purposeCriterion = "CAPITAL_ACQUIRED"; });
  const cost = await f.extraAccount("ASSET"), accum = await f.account("ASSET", "CREDIT", true);
  const d = await createDraft(f.actor, { journalType: "MANUAL", accountingDate: "2026-11-03", sourceReference: randomUUID(), description: "Synthetic TEST actual program equipment source", lines: [
    { accountId: cost, debit: "7000000.00", credit: "0.00", accountingFundId: u.row.id }, { accountId: f.apControl, debit: "0.00", credit: "7000000.00" }] });
  const req = await submitApproval(f.actor, { kind: "MANUAL_JOURNAL", sourceDocumentId: d.id, expectedRevision: 1 }); await f.approve(req.id); const j = await postApprovedJournal(f.poster, req.id), line = j.lines.find(l => l.accountId === cost); assert.ok(line);
  await assert.rejects(f.release(restriction.r.id, f.releaseInput(u.row.id, line.id)), /activated/);
  const category = await createCategory(f.actor, { categoryCode: randomUUID(), categoryName: "Synthetic TEST program equipment", assetAccountId: cost, accumulatedDepreciationAccountId: accum, depreciationExpenseAccountId: f.expense,
    gainAccountId: null, lossAccountId: null, impairmentExpenseAccountId: null, impairmentAllowanceAccountId: null, disposalClearingAccountId: null, defaultUsefulLifeMonths: 12, defaultMethod: "STRAIGHT_LINE", activeFlag: true,
    policy: { policyReference: "Synthetic TEST adopted capital policy", capitalizationThreshold: "0.00", partialMonthPolicy: "FULL_MONTH", impairmentEnabled: false, impairmentPolicyReference: null } }); f.categoryIds.push(category.id);
  const asset = await createAsset(f.actor, { assetNumber: randomUUID(), assetName: "Synthetic TEST education computer", description: null, location: null, custodianId: null, assetCategoryId: category.id, acquisitionJournalLineId: line.id,
    acquiredOn: "2026-11-03", inServiceOn: "2026-11-03", depreciationStartOn: "2026-11-01", usefulLifeMonths: 12, residualValue: "0.00", supportingEvidence: "Synthetic TEST donor-funded capital invoice and available-for-use evidence" });
  const activation = await submitApproval(f.actor, { kind: "ASSET_ACTIVATE", sourceDocumentId: asset.id, expectedRevision: 1 }); await f.approve(activation.id); await applyApprovedAction(f.poster, activation.id);
  await f.release(restriction.r.id, f.releaseInput(u.row.id, line.id)); assert.equal((await getFundMetrics(f.actor, r.row.id)).unreleasedRestrictions, "13000000.00"); assert.equal(await prisma.accountingFixedAsset.count(), 1);
}));
test("Opening classification references actual net-asset credit and is separate from contribution revenue", async () => fundScenario(async f => {
  const net = await f.account("NET_ASSET", "CREDIT"), u = await f.fund("UNRESTRICTED", true, v => { v.balanceAccountId = net; }), source = await f.manual("1000000.00", net);
  const d = await createFundMovement(f.actor, u.row.id, { action: "OPENING", sourceJournalLineId: source.line.id, amount: "1000000.00", accountingDate: "2026-11-03", sourceReference: randomUUID(), reason: "Synthetic TEST actual approved opening balance allocation" });
  const req = await submitApproval(f.actor, { kind: "FUND_JOURNAL", sourceDocumentId: d.id, expectedRevision: 1 }); await f.approve(req.id); await postApprovedJournal(f.poster, req.id);
  const m = await getFundMetrics(f.actor, u.row.id); assert.equal(m.openingNetAssetClassifications, "1000000.00"); assert.equal(m.recognizedContributionClassifications, "0.00"); assert.equal(m.accountingNetAssets, "1000000.00");
}));
test("Contribution source discovery exposes actual unallocated capacity without recognizing commitments", async () => fundScenario(async f => {
  const u = await f.fund(), s = await f.manual(); let sources = await contributionSources(f.actor, { page: 1, pageSize: 10, unallocatedOnly: true }); assert.equal(sources.total, 1); assert.equal(sources.rows[0]?.unallocatedAmount.toFixed(2), "20000000.00");
  await f.classify(u.row.id, s.line.id, "7000000.00"); sources = await contributionSources(f.actor, { page: 1, pageSize: 10, unallocatedOnly: true }); assert.equal(sources.rows[0]?.unallocatedAmount.toFixed(2), "13000000.00"); assert.equal(sources.recognitionCreated, false);
}));
test("Fund HTTP register, approval and balance endpoints preserve auth and source identity", async () => fundScenario(async f => {
  const template = await f.fund("UNRESTRICTED", false), { app } = await import("../../src/app.js"), { env } = await import("../../src/config/env.js");
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r)); const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/accounting`, call = (actor: string, route: string, body?: unknown, method = "POST") => fetch(url + route, { method, headers: { Authorization: `Bearer ${jwt.sign({ sub: actor }, env.jwtSecret)}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    assert.equal((await fetch(url + "/funds")).status, 401); assert.equal((await call(f.approval.outsiderId, "/funds", template.input)).status, 403);
    const response = await call(f.actor, "/funds", { ...template.input, fundCode: randomUUID() }); assert.equal(response.status, 201); const fund = await response.json();
    const submitted = await call(f.actor, `/funds/${fund.id}/submit`, { expectedRevision: 1 }); assert.equal(submitted.status, 201); const req = await submitted.json();
    assert.equal((await call(f.reviewer, `/approvals/${req.id}/decision`, { decision: "APPROVED" })).status, 200);
    assert.equal((await call(f.poster, `/funds/${template.row.id}/apply`, { approvalRequestId: req.id })).status, 409);
    assert.equal((await call(f.poster, `/funds/${fund.id}/apply`, { approvalRequestId: req.id })).status, 201);
    for (const route of ["/funds", "/fund-contribution-sources", `/funds/${fund.id}/balances`, `/funds/${fund.id}/reconciliation`, `/funds/${fund.id}/movements`]) assert.equal((await call(f.actor, route, undefined, "GET")).status, 200);
    const metrics = await (await call(f.actor, `/funds/${fund.id}/balances`, undefined, "GET")).json(); assert.equal(metrics.economicNetResources, "0.00"); assert.equal(await prisma.accountingJournal.count(), 0);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}));
test("Approved conditional reopening restores only the real bank hold and permits corrected source reversal", async () => fundScenario(async f => {
  const pending = await f.fund("CONDITIONAL_REVIEW", false), target = await f.fund("CONDITIONAL_LIABILITY"), bank = await f.bankSource("STANDARD", "20000000.00", false);
  const hold = await createFundCommand(f.actor, pending.row.id, fundCommandSchema.parse({ ...cmd, action: "CONDITIONAL_REVIEW", sourceReference: randomUUID(), bankTransactionId: bank.transactionId, policyEvidence: "Synthetic TEST unresolved donor obligation evidence" })), source = await f.manual("20000000.00", f.apControl);
  const resolved = await command(f, target.row.id, { ...cmd, action: "RESOLVE_CONDITIONAL", sourceReference: randomUUID(), parentId: hold.id, bankTransactionId: bank.transactionId, sourceJournalLineId: source.line.id, policyEvidence: "Synthetic TEST reviewed conditional liability policy" });
  const wrong = await f.fund(); await assert.rejects(command(f, wrong.row.id, { ...cmd, action: "REOPEN_CONDITIONAL", sourceReference: randomUUID(), parentId: resolved.d.id }), /this fund/);
  await command(f, target.row.id, { ...cmd, action: "REOPEN_CONDITIONAL", sourceReference: randomUUID(), parentId: resolved.d.id });
  assert.equal((await prisma.accountingJournalDraft.findUniqueOrThrow({ where: { id: hold.id } })).fundActiveBankId, bank.transactionId); assert.equal((await prisma.accountingJournalDraft.findUniqueOrThrow({ where: { id: resolved.d.id } })).fundActiveBankId, null);
  assert.ok(bank.approvalId); await assert.rejects(decideSignApprovalAtomic({ approvalId: bank.approvalId, userId: f.actor, decision: "APPROVED" }), /REVIEW_REQUIRED/);
  await f.reverse(source.journal.id); assert.deepEqual(await global(f), { revenue: "0.00", bank: "0.00" }); assert.equal((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: bank.transactionId } })).status, "CHECK");
}));
