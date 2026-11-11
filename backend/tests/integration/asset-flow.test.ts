import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../src/lib/prisma.js";
import { assetScenario, AssetFixture } from "./asset-fixture.js";
import { createAsset, createCategory, createRun, getAsset, previewRun, refreshRun, reviseAsset, updateCategory } from "../../src/modules/accounting/assets/asset.service.js";
import { createAssetChange } from "../../src/modules/accounting/assets/asset-change.service.js";
import { assetReconciliation, submitAssetSource, cancelAssetSource } from "../../src/modules/accounting/assets/asset.workflow.js";
import { applyApprovedAction, decideApproval, postApprovedJournal, postApprovedJournalInTransaction, submitApproval } from "../../src/modules/accounting/approval/approval.service.js";
import { requestSourceReversal } from "../../src/modules/accounting/apar/apar.service.js";
import { createSchedule } from "../../src/modules/accounting/schedules/schedule.service.js";
async function reconciled(f: AssetFixture) { const r = await assetReconciliation(f.actor); assert.equal(r.reconciled, true, JSON.stringify(r)); }
async function reverse(f: AssetFixture, id: string, date = "2026-12-31") {
  const req = await submitApproval(f.actor, { kind: "JOURNAL_REVERSAL", sourceDocumentId: id, accountingDate: date, remark: "Synthetic TEST authorized reversal" });
  await f.approve(req.id); return postApprovedJournal(f.poster, req.id);
}
test("Fixed asset AP registration and independently approved activation never capitalize/pay twice", async () => assetScenario(async f => {
  const a = await f.asset(); assert.ok(a.request);
  assert.equal(await prisma.accountingJournal.count(), 1);
  const repeat = await applyApprovedAction(f.poster, a.request.id); assert.ok("alreadyApplied" in repeat && repeat.alreadyApplied);
  const detail = await getAsset(f.actor, a.asset.id); assert.equal(detail.status, "ACTIVE"); assert.equal(detail.grossCost, "12000000.00");
  await assert.rejects(createAsset(f.actor, { ...a.input, assetNumber: `TEST-${randomUUID()}` }));
  await f.settlement("PAYABLE", f.settlementInput(a.source.cp, [{ accountingDocumentId: a.source.doc.id, allocatedAmount: "3000000.00" }], "3000000.00"));
  await f.settlement("PAYABLE", f.settlementInput(a.source.cp, [{ accountingDocumentId: a.source.doc.id, allocatedAmount: "9000000.00" }], "9000000.00"));
  assert.equal((await getAsset(f.actor, a.asset.id)).grossCost, "12000000.00"); await reconciled(f);
}));
test("Asset category mapping, missing policy and explicit capitalization threshold fail closed", async () => assetScenario(async f => {
  await assert.rejects(createCategory(f.actor, { ...f.categoryInput(), accumulatedDepreciationAccountId: f.cost }));
  const source = await f.invoice(), category = await f.category(f.categoryInput(null)), input = { ...f.input(source.line.id), assetCategoryId: category.id };
  const a = await createAsset(f.actor, input); await assert.rejects(submitAssetSource(f.actor, "ASSET", a.id, 1), /PENDING POLICY/);
  assert.equal((await getAsset(f.actor, a.id)).status, "DRAFT");
  const expensive = await f.category(f.categoryInput({ ...f.policy(), capitalizationThreshold: "20000000.00" }));
  const second = await f.invoice(), b = await createAsset(f.actor, { ...f.input(second.line.id), assetCategoryId: expensive.id });
  await assert.rejects(submitAssetSource(f.actor, "ASSET", b.id, 1), /threshold/);
}));
test("Straight-line monthly depreciation posts actual contra/expense lines and stops at residual", async () => assetScenario(async f => {
  const a = await f.asset("12000000.00", true, input => { input.residualValue = "2000000.00"; });
  const nov = await f.run([a.asset.id]); assert.ok(nov.journal);
  assert.equal(nov.journal.lines[0]?.debit.toFixed(2), "5000000.00"); assert.equal(nov.journal.lines[1]?.credit.toFixed(2), "5000000.00");
  await f.run([a.asset.id], "2026-12"); const state = await getAsset(f.actor, a.asset.id);
  assert.equal(state.accumulatedDepreciation, "10000000.00"); assert.equal(state.carryingAmount, "2000000.00"); assert.equal(state.depreciationState, "FULLY_DEPRECIATED");
  await assert.rejects(f.run([a.asset.id], "2026-12")); await reconciled(f);
}));
test("Actual-day and next-month policies respect available-for-use date and exact partial months", async () => assetScenario(async f => {
  const dailyCategory = await f.category(f.categoryInput(f.policy("ACTUAL_DAYS"))), dailySource = await f.invoice("61.00");
  const input = f.input(dailySource.line.id, "ACTUAL_DAYS", "2026-11-15"); input.assetCategoryId = dailyCategory.id;
  const daily = await createAsset(f.actor, input), req = await submitAssetSource(f.actor, "ASSET", daily.id, 1); await f.approve(req.id); await applyApprovedAction(f.poster, req.id);
  const n = await f.run([daily.id]); assert.equal(n.journal?.lines[0]?.debit.toFixed(2), "16.00");
  await f.run([daily.id], "2026-12"); assert.equal((await getAsset(f.actor, daily.id)).carryingAmount, "14.00");
  const nextCat = await f.category(f.categoryInput(f.policy("NEXT_MONTH"))), nextSource = await f.invoice("100.00"), nextInput = f.input(nextSource.line.id, "NEXT_MONTH", "2026-11-15"); nextInput.assetCategoryId = nextCat.id;
  const next = await createAsset(f.actor, nextInput), r = await submitAssetSource(f.actor, "ASSET", next.id, 1); await f.approve(r.id); await applyApprovedAction(f.poster, r.id);
  await assert.rejects(f.run([next.id])); const d = await f.run([next.id], "2026-12"); assert.equal(d.journal?.lines[0]?.debit.toFixed(2), "50.00"); await reconciled(f);
}));
test("Different runs cannot reserve the same asset/period and concurrent posting has one winner", async () => assetScenario(async f => {
  const a = await f.asset(), run = await f.run([a.asset.id], "2026-11", false);
  await assert.rejects(createRun(f.actor, { ...run.input, runReference: `TEST-${randomUUID()}` }));
  const results = await Promise.allSettled([postApprovedJournal(f.poster, run.req.id), postApprovedJournal(f.poster, run.req.id)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await prisma.accountingJournal.count({ where: { sourceKind: "DEPRECIATION_RUN", sourceReference: run.run.id } }), 1);
  assert.equal(await prisma.accountingApprovalHistory.count({ where: { approvalRequestId: run.req.id, action: "APPLY" } }), 1); await reconciled(f);
}));
test("Closed fiscal period rejects approved depreciation without consuming approval", async () => assetScenario(async f => {
  const a = await f.asset(), run = await f.run([a.asset.id], "2026-11", false), period = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: "2026-11" } });
  try { await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: "CLOSED", closedAt: new Date() } });
    await assert.rejects(postApprovedJournal(f.poster, run.req.id), /OPEN/);
    assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: run.req.id } })).status, "APPROVED");
  } finally { await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: period.status, closedAt: period.closedAt } }); }
}));
test("Asset revision, independent approval and posting permissions reject stale/self/unauthorized actions", async () => assetScenario(async f => {
  const a = await f.asset("12000000.00", false), req = await submitAssetSource(f.actor, "ASSET", a.asset.id, 1);
  await assert.rejects(decideApproval(f.actor, req.id, "APPROVED", null), { status: 403 }); await f.approve(req.id);
  await assert.rejects(applyApprovedAction(f.actor, req.id), { status: 403 });
  await reviseAsset(f.actor, a.asset.id, 1, { ...a.input, assetName: "Synthetic TEST revised evidence" });
  await assert.rejects(applyApprovedAction(f.poster, req.id));
  const fresh = await submitAssetSource(f.actor, "ASSET", a.asset.id, 2); await f.approve(fresh.id); await applyApprovedAction(f.poster, fresh.id);
}));
test("Run refresh requires new approval after an auditable acquisition-information correction", async () => assetScenario(async f => {
  const a = await f.asset(), run = await f.run([a.asset.id], "2026-11", false);
  await f.change(a.asset.id, { action: "CORRECTION", effectiveDate: "2026-11-03", location: "TEST corrected location", reason: "Synthetic TEST documented error correction" });
  await assert.rejects(postApprovedJournal(f.poster, run.req.id)); await refreshRun(f.actor, run.run.id, 1);
  const next = await submitAssetSource(f.actor, "RUN", run.run.id, 2); await f.approve(next.id); await postApprovedJournal(f.poster, next.id); await reconciled(f);
}));
test("Useful-life estimates apply prospectively without rewriting previous depreciation", async () => assetScenario(async f => {
  const a = await f.asset(), nov = await f.run([a.asset.id]); assert.ok(nov.journal);
  const before = await prisma.accountingJournal.findUniqueOrThrow({ where: { id: nov.journal.id }, include: { lines: true } });
  await f.change(a.asset.id, { action: "ESTIMATE", effectiveDate: "2026-12-01", remainingLifeMonths: 2, residualValue: "0.00", reason: "Synthetic TEST revised future useful-life estimate" });
  const dec = await f.run([a.asset.id], "2026-12"); assert.equal(dec.journal?.lines[0]?.debit.toFixed(2), "3000000.00");
  assert.equal((await getAsset(f.actor, a.asset.id)).carryingAmount, "3000000.00");
  assert.deepEqual(await prisma.accountingJournal.findUniqueOrThrow({ where: { id: nov.journal.id }, include: { lines: true } }), before); await reconciled(f);
}));
test("Additional capital cost claims an existing asset debit and changes only future depreciation", async () => assetScenario(async f => {
  const a = await f.asset(); await f.run([a.asset.id]); const extra = await f.invoice("3000000.00"), count = await prisma.accountingJournal.count();
  await f.change(a.asset.id, { action: "ADDITIONAL", effectiveDate: "2026-12-01", sourceJournalLineId: extra.line.id,
    remainingLifeMonths: 3, residualValue: "0.00", reason: "Synthetic TEST qualifying enhancement from actual invoice" });
  assert.equal(await prisma.accountingJournal.count(), count); assert.equal((await getAsset(f.actor, a.asset.id)).grossCost, "15000000.00");
  const dec = await f.run([a.asset.id], "2026-12"); assert.equal(dec.journal?.lines[0]?.debit.toFixed(2), "3000000.00"); await reconciled(f);
}));
test("Asset reclassification moves cost and accumulated accounts with no carrying-value change", async () => assetScenario(async f => {
  const a = await f.asset(); await f.run([a.asset.id]);
  const category = await f.category({ ...f.categoryInput(), assetAccountId: await f.account("ASSET", "DEBIT"),
    accumulatedDepreciationAccountId: await f.account("ASSET", "CREDIT", true), depreciationExpenseAccountId: await f.account("EXPENSE", "DEBIT") });
  const moved = await f.change(a.asset.id, { action: "RECLASSIFY", effectiveDate: "2026-12-01", categoryId: category.id, reason: "Synthetic TEST controlled asset reclassification" });
  const applied = await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: moved.req.id }, include: { appliedJournal: { include: { lines: true } } } });
  const movedCost = applied.appliedJournal?.lines.find(l => l.accountId === category.assetAccountId); assert.ok(movedCost);
  await assert.rejects(createAssetChange(f.actor, a.asset.id, { action: "ADDITIONAL", effectiveDate: "2026-12-01", sourceJournalLineId: movedCost.id,
    remainingLifeMonths: 1, residualValue: "0.00", reason: "Synthetic TEST must not capitalize reclassification again" }), /Additional capital cost/);
  assert.equal((await getAsset(f.actor, a.asset.id)).carryingAmount, "6000000.00"); await reconciled(f);
  await f.run([a.asset.id], "2026-12"); await reconciled(f);
}));
test("Impairment uses explicit assessment, posts approved loss and recalculates depreciation prospectively", async () => assetScenario(async f => {
  const a = await f.asset(); await f.run([a.asset.id]);
  await f.change(a.asset.id, { action: "IMPAIRMENT", effectiveDate: "2026-12-01", recoverableAmount: "4000000.00", residualValue: "0.00", remainingLifeMonths: 2,
    assessmentEvidence: "Synthetic TEST signed recoverable amount assessment", reason: "Synthetic TEST supported impairment loss" });
  assert.equal((await getAsset(f.actor, a.asset.id)).impairment, "2000000.00");
  const dec = await f.run([a.asset.id], "2026-12"); assert.equal(dec.journal?.lines[0]?.debit.toFixed(2), "2000000.00"); assert.equal((await getAsset(f.actor, a.asset.id)).carryingAmount, "2000000.00"); await reconciled(f);
  const pending = await createAssetChange(f.actor, a.asset.id, { action: "IMPAIRMENT_REVERSAL", effectiveDate: "2026-12-31", reason: "Synthetic TEST valuation recovery review", assessmentEvidence: "Synthetic TEST recovery assessment awaiting adopted framework" });
  assert.equal(pending.policyStatus, "PENDING_POLICY"); await assert.rejects(submitAssetSource(f.actor, "CHANGE", pending.id, 1), /PENDING POLICY/);
}));
for (const proceeds of ["5000000.00", "3000000.00"]) test(`Asset sale with proceeds ${proceeds} recognizes net gain/loss and actual receivable once`, async () => assetScenario(async f => {
  const a = await f.asset("12000000.00", true, input => { input.usefulLifeMonths = 3; });
  await f.run([a.asset.id]); await f.run([a.asset.id], "2026-12");
  const sale = await f.invoice(proceeds, f.clearing, "RECEIVABLE"), costs = await f.invoice("200000.00", f.loss);
  const disposal = await f.change(a.asset.id, { action: "DISPOSE", effectiveDate: "2026-12-31", proceeds, considerationJournalLineId: sale.line.id, costJournalLineId: costs.line.id, reason: "Synthetic TEST authorized sale with actual AR and incurred costs" });
  const state = await getAsset(f.actor, a.asset.id); assert.equal(state.status, "DISPOSED"); assert.equal(state.carryingAmount, "0.00");
  const applied = await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: disposal.req.id }, include: { appliedJournal: { include: { lines: true } } } });
  const lines = applied.appliedJournal?.lines ?? [];
  if (proceeds === "5000000.00") assert.equal(lines.find(l => l.accountId === f.gain)?.credit.toFixed(2), "800000.00");
  else assert.equal(lines.find(l => l.accountId === f.loss && l.debit.greaterThan(0))?.debit.toFixed(2), "1200000.00");
  assert.equal(await prisma.accountingJournal.count({ where: { sourceKind: "AR_DOCUMENT", sourceReference: sale.doc.id } }), 1);
  await assert.rejects(f.run([a.asset.id], "2026-12")); await reconciled(f);
}));
test("Write-off removes remaining cost/contra and reversal restores register with original journals intact", async () => assetScenario(async f => {
  const a = await f.asset(); await f.run([a.asset.id]);
  const writeOff = await f.change(a.asset.id, { action: "WRITE_OFF", effectiveDate: "2026-12-01", reason: "Synthetic TEST authorized loss of service potential" });
  const request = await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: writeOff.req.id } }); assert.ok(request.appliedJournalId);
  assert.equal((await getAsset(f.actor, a.asset.id)).status, "WRITTEN_OFF"); await reconciled(f);
  await reverse(f, request.appliedJournalId, "2026-12-01"); assert.equal((await getAsset(f.actor, a.asset.id)).status, "ACTIVE");
  assert.equal((await getAsset(f.actor, a.asset.id)).carryingAmount, "6000000.00"); assert.ok(await prisma.accountingJournal.findUnique({ where: { id: request.appliedJournalId } })); await reconciled(f);
}));
test("Depreciation posting failure rolls run, GL lines and approval application back atomically", async () => assetScenario(async f => {
  const a = await f.asset(), run = await f.run([a.asset.id], "2026-11", false), abort = new Error("TEST injected asset posting failure");
  await assert.rejects(prisma.$transaction(async tx => { await postApprovedJournalInTransaction(tx, f.poster, run.req.id); throw abort; }), e => e === abort);
  assert.equal((await prisma.accountingDepreciationRun.findUniqueOrThrow({ where: { id: run.run.id } })).status, "DRAFT");
  assert.equal(await prisma.accountingJournal.count({ where: { sourceReference: run.run.id } }), 0);
  assert.equal(await prisma.accountingDepreciationRunAsset.count({ where: { depreciationRunId: run.run.id, expenseJournalLineId: { not: null } } }), 0);
  assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: run.req.id } })).status, "APPROVED"); await reconciled(f);
}));
test("Run cancellation/reversal releases only active reservation and protects acquisition/schedule sources", async () => assetScenario(async f => {
  const a = await f.asset(), draft = await f.run([a.asset.id], "2026-11", false);
  await cancelAssetSource(f.actor, "RUN", draft.run.id, 1, "Synthetic TEST cancelled selection");
  const run = await f.run([a.asset.id]); assert.ok(run.journal); await reverse(f, run.journal.id, "2026-11-30");
  assert.equal((await getAsset(f.actor, a.asset.id)).accumulatedDepreciation, "0.00");
  await f.run([a.asset.id]); await reconciled(f);
  await assert.rejects(requestSourceReversal(f.actor, "PAYABLE", "DOCUMENT", a.source.doc.id, { accountingDate: "2026-12-31", remark: "TEST blocked source" }));
  await assert.rejects(createSchedule(f.actor, f.scheduleInput("PREPAYMENT", a.source.line.id)));
}));
test("Asset HTTP register/preview/approval/run routes retain existing auth and response contracts", async () => assetScenario(async f => {
  const { app } = await import("../../src/app.js"), { env } = await import("../../src/config/env.js"), source = await f.invoice();
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r)); const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/accounting`, call = (actor: string, route: string, body?: unknown, method = "POST") => fetch(url + route, {
    method, headers: { Authorization: `Bearer ${jwt.sign({ sub: actor }, env.jwtSecret)}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    assert.equal((await fetch(url + "/assets")).status, 401); assert.equal((await call(f.approval.outsiderId, "/assets", f.input(source.line.id))).status, 403);
    const created = await call(f.actor, "/assets", f.input(source.line.id)); assert.equal(created.status, 201); const asset = await created.json();
    const submitted = await call(f.actor, `/assets/${asset.id}/submit`, { expectedRevision: 1 }); assert.equal(submitted.status, 201); const request = await submitted.json();
    assert.equal((await call(f.reviewer, `/approvals/${request.id}/decision`, { decision: "APPROVED" })).status, 200);
    assert.equal((await call(f.poster, `/assets/${asset.id}/activate`, { approvalRequestId: request.id })).status, 201);
    const period = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: "2026-11" } });
    assert.equal((await call(f.actor, "/depreciation-runs/preview", { runReference: `TEST-${randomUUID()}`, accountingPeriodId: period.id, assetIds: [asset.id] })).status, 200);
    for (const route of [`/assets/${asset.id}`, `/assets/${asset.id}/journals`, "/assets/reconciliation", "/asset-categories", "/depreciation-runs"]) assert.equal((await call(f.actor, route, undefined, "GET")).status, 200);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}));

test("Multi-asset runs map exact rounded expense/contra lines to each source through completion", async () => assetScenario(async f => {
  const a = await f.asset("100.01"), b = await f.asset("200.01");
  const nov = await f.run([a.asset.id, b.asset.id]); assert.equal(nov.journal?.lines.length, 4);
  assert.equal((await getAsset(f.actor, a.asset.id)).accumulatedDepreciation, "50.00");
  assert.equal((await getAsset(f.actor, b.asset.id)).accumulatedDepreciation, "100.00");
  await f.run([b.asset.id, a.asset.id], "2026-12");
  assert.equal((await getAsset(f.actor, a.asset.id)).accumulatedDepreciation, "100.01");
  assert.equal((await getAsset(f.actor, b.asset.id)).accumulatedDepreciation, "200.01"); await reconciled(f);
}));

test("Reclassification and erroneous impairment reversal restore category/plan without rewriting history", async () => assetScenario(async f => {
  const a = await f.asset(); await f.run([a.asset.id]);
  const category = await f.category({ ...f.categoryInput(), assetAccountId: await f.account("ASSET", "DEBIT"), accumulatedDepreciationAccountId: await f.account("ASSET", "CREDIT", true) });
  const change = await f.change(a.asset.id, { action: "RECLASSIFY", categoryId: category.id, effectiveDate: "2026-12-01", reason: "Synthetic TEST classification correction" });
  const applied = await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: change.req.id } }); assert.ok(applied.appliedJournalId);
  await reverse(f, applied.appliedJournalId, "2026-12-01"); assert.equal((await getAsset(f.actor, a.asset.id)).assetCategoryId, f.categoryId); await reconciled(f);
  const loss = await f.change(a.asset.id, { action: "IMPAIRMENT", effectiveDate: "2026-12-01", recoverableAmount: "4000000.00", residualValue: "0.00", remainingLifeMonths: 2,
    assessmentEvidence: "Synthetic TEST assessment subsequently found erroneous", reason: "Synthetic TEST error correction requires explicit journal reversal" });
  const evidence = await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: loss.req.id } }); assert.ok(evidence.appliedJournalId);
  await reverse(f, evidence.appliedJournalId, "2026-12-01"); assert.equal((await getAsset(f.actor, a.asset.id)).impairment, "0.00");
  await f.run([a.asset.id], "2026-12"); assert.equal((await getAsset(f.actor, a.asset.id)).carryingAmount, "0.00"); await reconciled(f);
}));

test("Actual approved manual cash acquisition and cash sale create no duplicate bank journal or fake transaction", async () => assetScenario(async f => {
  const acquired = await f.manual("100.01", f.cost, f.bankGl), line = acquired.lines.find(l => l.accountId === f.cost); assert.ok(line);
  const asset = await createAsset(f.actor, f.input(line.id)), req = await submitAssetSource(f.actor, "ASSET", asset.id, 1); await f.approve(req.id); await applyApprovedAction(f.poster, req.id);
  const cash = await f.manual("120.01", f.bankGl, f.clearing), consideration = cash.lines.find(l => l.accountId === f.clearing); assert.ok(consideration);
  const before = await prisma.accountingJournalLine.count({ where: { accountId: f.bankGl } });
  await f.change(asset.id, { action: "DISPOSE", effectiveDate: "2026-11-03", proceeds: "120.01", considerationJournalLineId: consideration.id, costJournalLineId: null,
    reason: "Synthetic TEST approved disposal against recorded cash evidence" });
  assert.equal(await prisma.accountingJournalLine.count({ where: { accountId: f.bankGl } }), before);
  assert.equal(await prisma.bankTransaction.count(), 0); assert.equal((await getAsset(f.actor, asset.id)).status, "DISPOSED"); await reconciled(f);
}));

test("Unused categories can be revised while mappings referenced by asset history remain immutable", async () => assetScenario(async f => {
  const input = f.categoryInput(), unused = await f.category(input);
  const revised = await updateCategory(f.actor, unused.id, 1, { ...input, categoryName: "Synthetic TEST revised unused category" }); assert.equal(revised.revision, 2);
  const a = await f.asset();
  await assert.rejects(updateCategory(f.actor, f.categoryId, 1, f.categoryInput()), /immutable/);
  await f.change(a.asset.id, { action: "RECLASSIFY", effectiveDate: "2026-11-03", categoryId: unused.id, reason: "Synthetic TEST mapping history protection" });
  await assert.rejects(updateCategory(f.actor, f.categoryId, 1, f.categoryInput()), /history.*immutable/); await reconciled(f);
}));
