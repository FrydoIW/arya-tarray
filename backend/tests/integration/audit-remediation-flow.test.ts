import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../src/lib/prisma.js";
import { finalScenario, type FinalizationFixture } from "./finalization-fixture.js";
import { createDraft, submitApproval, applyApprovedAction, decideApproval } from "../../src/modules/accounting/approval/approval.service.js";
import { requestClosing } from "../../src/modules/accounting/finalization/finalization.workflow.js";
import { previewClose } from "../../src/modules/accounting/finalization/closing.service.js";
import { verifyPostedLedgerAudits } from "../../src/modules/accounting/ledger/ledger-audit.js";
import { assetReconciliationAsOf } from "../../src/modules/accounting/finalization/reconciliation.service.js";
import { createFiscalYear, createPeriod } from "../../src/modules/accounting/period/period.service.js";
import { digest, material } from "../../src/modules/accounting/funds/fund.repository.js";
import { syntheticAuditJournal } from "../helpers/audit-journal.js";
import { readCsv } from "../helpers/read-csv.js";
async function pendingDraft(f: FinalizationFixture, date: string) {
  const draft = await createDraft(f.actor, { journalType: "MANUAL", accountingDate: date, sourceReference: randomUUID(), description: "Synthetic TEST pending period scope evidence", lines: [
    { accountId: f.expense, debit: "1.00", credit: "0.00" }, { accountId: f.apControl, debit: "0.00", credit: "1.00" }] });
  return { draft, request: await submitApproval(f.actor, { kind: "MANUAL_JOURNAL", sourceDocumentId: draft.id, expectedRevision: draft.revision }) };
}
async function approvalControl(f: FinalizationFixture, periodCode: string) {
  const period = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode } }), preview = await previewClose(f.actor, "PERIOD", period.id), control = preview.items.find(i => i.control === "PENDING_APPROVALS");
  assert.ok(control); return { period, preview, control };
}
test("AT-AUD-01 October pending and approved-but-not-applied block October using source date, never requestedAt", async () => finalScenario(async f => {
  await f.policy(); await f.signBank("0.00", "2026-10"); const pending = await pendingDraft(f, "2026-10-20");
  await prisma.accountingApprovalRequest.update({ where: { id: pending.request.id }, data: { requestedAt: new Date("2026-11-01") } });
  let c = await approvalControl(f, "2026-10"); assert.equal(c.control.status, "FAIL"); assert.match(JSON.stringify(c.control.evidence), /UNRESOLVED_IN_PERIOD_APPROVAL/);
  await assert.rejects(requestClosing(f.actor, "PERIOD", c.period.id, false, "Synthetic TEST invalid close", "Synthetic TEST unresolved approval"), /not ready/);
  await f.approve(pending.request.id); c = await approvalControl(f, "2026-10"); assert.equal(c.control.status, "FAIL"); assert.match(JSON.stringify(c.control.evidence), /APPROVED/);
}));
test("AT-AUD-01 concurrent December approval never blocks or stales October close; CLOSED posting and independent reopening stay enforced", async () => finalScenario(async f => {
  await f.policy(); await f.signBank("0.00", "2026-10"); const period = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: "2026-10" } });
  const draft = await createDraft(f.actor, { journalType: "MANUAL", accountingDate: "2026-12-02", sourceReference: randomUUID(), description: "Synthetic TEST future request", lines: [{ accountId: f.expense, debit: "1.00", credit: "0.00" }, { accountId: f.apControl, debit: "0.00", credit: "1.00" }] });
  const [close, future] = await Promise.all([requestClosing(f.actor, "PERIOD", period.id, false, "Synthetic TEST October close", "Synthetic TEST independent cut-off review"), submitApproval(f.actor, { kind: "MANUAL_JOURNAL", sourceDocumentId: draft.id, expectedRevision: 1 })]);
  await f.approve(close.approval.id); await pendingDraft(f, "2026-12-03");
  await applyApprovedAction(f.poster, close.approval.id); assert.equal((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: period.id } })).status, "CLOSED");
  assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: future.id } })).status, "PENDING");
  await assert.rejects(f.manual("1.00", f.revenue, null, false, "2026-10-20"), /open/i);
  const reopen = await requestClosing(f.actor, "PERIOD", period.id, true, "Synthetic TEST correction requested", "Synthetic TEST independent reopening evidence");
  await assert.rejects(applyApprovedAction(f.poster, reopen.approval.id), /approval|decided/i);
  await assert.rejects(decideApproval(f.actor, reopen.approval.id, "APPROVED", null), /Requester|authorized/);
  await f.approve(reopen.approval.id); await applyApprovedAction(f.poster, reopen.approval.id);
}));
test("AT-AUD-01 unresolved prior October approval explicitly blocks November", async () => finalScenario(async f => {
  const r = await pendingDraft(f, "2026-10-20"), c = await approvalControl(f, "2026-11");
  assert.equal(c.control.status, "FAIL"); assert.match(JSON.stringify(c.control.evidence), /UNRESOLVED_PRIOR_PERIOD_APPROVAL/); assert.match(JSON.stringify(c.control.evidence), new RegExp(r.request.id));
}));
test("AT-AUD-01 unknown reversal accounting date fails closed even when original source has a known date", async () => finalScenario(async f => {
  const original = await f.manual("1.00"), request = await submitApproval(f.actor, { kind: "JOURNAL_REVERSAL", sourceDocumentId: original.journal.id, accountingDate: "2026-11-04", remark: "Synthetic TEST requested reversal" });
  await prisma.accountingApprovalRequest.update({ where: { id: request.id }, data: { requestPayload: { accountingDate: "invalid", remark: "Synthetic TEST malformed imported request" } } });
  const c = await approvalControl(f, "2026-10"); assert.equal(c.control.status, "FAIL"); assert.match(JSON.stringify(c.control.evidence), /UNKNOWN_SOURCE_ACCOUNTING_DATE/);
}));
test("AT-AUD-01 next-year pending approval does not block prior fiscal year readiness", async () => finalScenario(async f => {
  await f.policy(); for (const month of ["2026-10", "2026-11", "2026-12"]) { await f.signBank("0.00", month); await f.close(month); }
  const year = await createFiscalYear({ yearCode: `T27-${randomUUID().slice(0, 6)}`, startDate: "2027-01-01", endDate: "2027-12-31" });
  await createPeriod({ fiscalYearId: year.id, periodNo: 1, periodCode: `T27-${randomUUID().slice(0, 6)}`, startDate: "2027-01-01", endDate: "2027-01-31" });
  await pendingDraft(f, "2027-01-02"); const preview = await previewClose(f.actor, "YEAR", f.fiscalYearId);
  assert.equal(preview.items.find(i => i.control === "PENDING_APPROVALS")?.status, "PASS"); assert.equal(preview.status, "READY", JSON.stringify(preview.items.filter(i => i.status === "FAIL")));
}));
test("AT-AUD-02 actual CSV download protects every text field and retains exact negative financial amounts and source values", async () => finalScenario(async f => {
  await prisma.accountingAccount.update({ where: { id: f.expense }, data: { code: "-123" } });
  const cp = await f.counterparty(); await f.document("PAYABLE", cp, "999999999999999.99");
  const { app } = await import("../../src/app.js"), { env } = await import("../../src/config/env.js");
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r)); const address = server.address(); assert.ok(address && typeof address !== "string");
  const query = new URLSearchParams(f.query()), url = `http://127.0.0.1:${address.port}/api/accounting/financial-statements/export?${query}&format=csv`, headers = { Authorization: `Bearer ${jwt.sign({ sub: f.actor }, env.jwtSecret)}` };
  try {
    for (const value of ['=SUM(1,2) TEST', '+SUM(1,2) TEST', '-SUM(1,2) TEST', '@SUM(1,2) TEST', '  =SUM(1,2) TEST', '\t=SUM(1,2) TEST', '\r\n=SUM(1,2) TEST', ' =SUM(1,2)\r\n"quoted", TEST', 'Normal, "quoted"\r\npolicy text']) {
      const policy = await f.policy(p => { p.policyReference = value; }), before = await prisma.accountingJournalDraft.findUniqueOrThrow({ where: { id: policy.d.id } });
      const response = await fetch(url, { headers }); assert.equal(response.status, 200); const wire = await response.text(), rows = readCsv(wire), normalized = value.trim();
      assert.equal(rows.find(r => r[0] === "Policy")?.[1], /^[=+@-]/.test(normalized) ? "'" + normalized : normalized);
      assert.ok(rows.some(r => r[0].startsWith("'-123 "))); assert.equal(rows.find(r => r[0] === "Surplus/deficit")?.[1], "-999999999999999.99");
      assert.ok(wire.includes('"-999999999999999.99"'));
      const after = await prisma.accountingJournalDraft.findUniqueOrThrow({ where: { id: policy.d.id } }); assert.deepEqual(after.finalizationMetadata, before.finalizationMetadata);
      if (value.includes('"quoted"')) assert.ok(wire.includes('""quoted""'));
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}));
async function seedSealedJournals(f: FinalizationFixture, start: number, count: number) {
  const p = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: "2026-11" } });
  for (let offset = 0; offset < count; offset += 200) {
    const rows = Array.from({ length: Math.min(200, count - offset) }, (_, i) => syntheticAuditJournal(start + offset + i, { actor: f.poster, period: p.id, debitAccount: f.expense, creditAccount: f.apControl }));
    await prisma.$transaction(async tx => {
      await tx.accountingJournal.createMany({ data: rows.map(({ lines, ...header }) => header) });
      await tx.accountingJournalLine.createMany({ data: rows.flatMap(j => j.lines.map(l => ({ ...l, journalId: j.id }))) });
      await tx.accountingJournalDraft.createMany({ data: rows.map(j => ({ sourceKind: "FINALIZATION_AUDIT", sourceReference: `JRNAUDIT-${j.id}`, draftNumber: `JRNAUDIT-${j.id}`, journalType: "ADJUSTMENT", accountingDate: j.accountingDate, accountingPeriodId: p.id, status: "APPLIED", createdById: f.poster, finalizationMetadata: material({ action: "POSTED_LEDGER_SEAL_V1", journalId: j.id, sha256: digest(j) }) })) });
    });
  }
}
test("AT-AUD-03 real TEST verifies all 5001 journals, detects first/last batch tamper and missing final seal", async () => finalScenario(async f => {
  const verify = () => prisma.$transaction(tx => verifyPostedLedgerAudits(tx, new Date("2026-11-30")), { isolationLevel: "RepeatableRead", timeout: 60000 });
  assert.equal((await verify()).checked, 0); await seedSealedJournals(f, 1, 1); assert.equal((await verify()).checked, 1);
  await seedSealedJournals(f, 2, 4999); let result = await verify(); assert.equal(result.valid, true); assert.equal(result.checked, 5000);
  await seedSealedJournals(f, 5001, 1); result = await verify(); assert.equal(result.valid, true); assert.equal(result.checked, 5001); assert.deepEqual(await verify(), result);
  for (const index of [1, 5001]) {
    const row = syntheticAuditJournal(index); await prisma.accountingJournal.update({ where: { id: row.id }, data: { descriptionSnapshot: "Synthetic TEST detected tamper" } });
    result = await verify(); assert.equal(result.valid, false); assert.equal(result.checked, 5001); assert.ok(result.exceptions.some(e => e.id === row.id && e.reason === "POSTED_JOURNAL_CONTENT_CHANGED"));
    await prisma.accountingJournal.update({ where: { id: row.id }, data: { descriptionSnapshot: row.descriptionSnapshot } });
  }
  const last = syntheticAuditJournal(5001); await prisma.accountingJournalDraft.deleteMany({ where: { sourceReference: `JRNAUDIT-${last.id}` } });
  result = await verify(); assert.equal(result.valid, false); assert.equal(result.checked, 5001); assert.ok(result.exceptions.some(e => e.id === last.id && e.reason === "POSTED_JOURNAL_SEAL_MISSING"));
}));
test("AT-AUD-03 concurrent TEST changes preserve full consistent snapshot and become detectable on the next verification", async () => finalScenario(async f => {
  await seedSealedJournals(f, 1, 1);
  const snapshot = await prisma.$transaction(async tx => {
    assert.equal(await tx.accountingJournal.count(), 1); await seedSealedJournals(f, 2, 1);
    await prisma.accountingJournal.update({ where: { id: syntheticAuditJournal(1).id }, data: { descriptionSnapshot: "Synthetic TEST concurrent tamper" } });
    return verifyPostedLedgerAudits(tx, new Date("2026-11-30"));
  }, { isolationLevel: "RepeatableRead", timeout: 60000 });
  assert.equal(snapshot.valid, true); assert.equal(snapshot.checked, 1);
  const current = await prisma.$transaction(tx => verifyPostedLedgerAudits(tx, new Date("2026-11-30")), { isolationLevel: "Serializable", timeout: 30000 });
  assert.equal(current.valid, false); assert.equal(current.checked, 2); assert.ok(current.exceptions.some(e => e.reason === "POSTED_JOURNAL_CONTENT_CHANGED"));
}));
test("AT-AUD-03 truncated asset category evidence cannot report a false balanced control", async () => finalScenario(async f => {
  const cost = await f.extraAccount("ASSET"), contra = await f.account("ASSET", "CREDIT", true);
  const rows = Array.from({ length: 1001 }, () => { const id = randomUUID(); f.categoryIds.push(id); return { id, categoryCode: id, categoryName: "Synthetic TEST capacity category", assetAccountId: cost, accumulatedDepreciationAccountId: contra, depreciationExpenseAccountId: f.expense, defaultUsefulLifeMonths: 12 }; });
  await prisma.accountingAssetCategory.createMany({ data: rows });
  const result = await prisma.$transaction(tx => assetReconciliationAsOf(tx, "2026-11-30"), { isolationLevel: "Serializable" });
  assert.equal(result.status, "UNVERIFIED"); assert.ok("truncated" in result && result.truncated); assert.ok(result.exceptions.some(e => e.code === "ASSET_CATEGORY_EVIDENCE_TRUNCATED"));
}));
