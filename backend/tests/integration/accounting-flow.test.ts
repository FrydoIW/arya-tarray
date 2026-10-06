import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma.js";
import { decideSignApprovalAtomic } from "../../src/modules/approval/sign-approval/sign-approval.repository.js";
import { postStatementRecognition } from "../../src/modules/accounting/accounting.posting.js";
import { FinancialFixture } from "./financial-fixture.js";
import { accountingQuerySchema } from "../../src/modules/accounting/accounting.schema.js";
import { getAccountingReport } from "../../src/modules/accounting/accounting.service.js";
import { exportAccountingReport } from "../../src/modules/accounting/accounting.report.js";
import ExcelJS from "exceljs";
import { createCarryTransfer, createCampaignWalletTransfer, reverseCarryTransfer } from "../../src/modules/member/time-based/member-carry-transfer.service.js";
import { moveIdentity, detachIdentity } from "../../src/modules/member/data/member-data.repository.js";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

async function scenario(work: (f: FinancialFixture) => Promise<void>) {
  const f = new FinancialFixture();
  try { await f.setup(); await work(f); } finally { await f.cleanup(); }
}

async function receipt(f: FinancialFixture, type = "STANDARD", date = "2026-11-01") {
  const identityId = await f.identity();
  const campaign = await f.campaign("Accounting Receipt", "999999.99");
  await prisma.eventCode.update({ where: { id: campaign.eventCodeId }, data: { eventType: type } });
  if (type === "TIME_BASED") await prisma.eventTimeRule.create({ data: { eventCodeId: campaign.eventCodeId, unitAmount: "100.00", durationMonths: 1 } });
  const input = await f.transaction({ identityId, ...campaign, amount: "100123.01", approval: true });
  await prisma.bankTransaction.update({ where: { id: input.transactionId }, data: {
    transactionDate: new Date(date), eventCampaignId: type === "CAMPAIGN" ? campaign.campaignId : null,
    baseAmount: "100000.00"
  } });
  return { ...input, ...campaign };
}

for (const type of ["STANDARD", "CAMPAIGN", "TIME_BASED"]) {
  test(`Accounting ${type}: FINALIZED recognition is atomic, exact, immutable and replay-safe`, async () => scenario(async f => {
    const row = await receipt(f, type);
    assert.equal(await prisma.accountingJournal.count({ where: { bankTransactionId: row.transactionId } }), 0);
    await decideSignApprovalAtomic({ approvalId: row.approvalId!, userId: f.userId, decision: "APPROVED" });
    const journal = await prisma.accountingJournal.findUniqueOrThrow({ where: { sourceEventKey: `FINALIZED_BANK_TRANSACTION:${row.transactionId}` }, include: { lines: true } });
    assert.equal(journal.accountingDate.toISOString().slice(0, 10), "2026-11-01");
    assert.equal(journal.lines.find(l => l.accountCodeSnapshot === "1110")!.debit.toFixed(2), "100123.01");
    assert.equal(journal.lines.find(l => l.accountCodeSnapshot === "4110")!.credit.toFixed(2), "100123.01");
    await prisma.$transaction(tx => postStatementRecognition(tx, row.statementId, f.userId, new Date()), { isolationLevel: "Serializable" });
    await assert.rejects(decideSignApprovalAtomic({ approvalId: row.approvalId!, userId: f.userId, decision: "APPROVED" }));
    assert.equal(await prisma.accountingJournal.count({ where: { bankTransactionId: row.transactionId } }), 1);
  }));
}

test("Accounting concurrent approval has one CAS winner and one source journal", async () => scenario(async f => {
  const row = await receipt(f);
  const input = { approvalId: row.approvalId!, userId: f.userId, decision: "APPROVED" as const };
  const results = await Promise.allSettled([decideSignApprovalAtomic(input), decideSignApprovalAtomic(input)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await prisma.accountingJournal.count({ where: { bankTransactionId: row.transactionId } }), 1);
}));

test("Accounting failure and serialization abort roll back the whole approval before retry", async () => scenario(async f => {
  const row = await receipt(f);
  const input = { approvalId: row.approvalId!, userId: f.userId, decision: "APPROVED" as const };
  const original = prisma.$transaction;
  type Work = (tx: Prisma.TransactionClient) => Promise<unknown>;
  const client = prisma as unknown as { $transaction: (work: Work, options?: unknown) => Promise<unknown> };
  let retry = false;
  let attempts = 0;
  client.$transaction = (work, options) => Reflect.apply(original, prisma, [async (tx: Prisma.TransactionClient) => {
    const result = await work(tx);
    attempts++;
    if (!retry) throw new Error("Injected accounting finalization failure");
    if (attempts === 1) throw new Prisma.PrismaClientKnownRequestError("Retry", { code: "P2034", clientVersion: "test" });
    return result;
  }, options]);
  try {
    await assert.rejects(decideSignApprovalAtomic(input), /Injected accounting/);
    assert.equal((await prisma.reconciliationApproval.findUniqueOrThrow({ where: { id: row.approvalId! } })).status, "PENDING");
    assert.equal((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: row.transactionId } })).status, "CHECK");
    assert.equal(await prisma.accountingJournal.count({ where: { bankTransactionId: row.transactionId } }), 0);
    retry = true; attempts = 0;
    await decideSignApprovalAtomic(input);
    assert.equal(attempts, 2);
    assert.equal(await prisma.accountingJournal.count({ where: { bankTransactionId: row.transactionId } }), 1);
  } finally { client.$transaction = original as never; }
}));

test("Accounting pre-cutover and rejected receipts do not fabricate history", async () => scenario(async f => {
  const pre = await receipt(f, "STANDARD", "2026-09-30");
  await prisma.bankTransaction.update({ where: { id: pre.transactionId }, data: { originalAmount: "100123.00" } });
  await decideSignApprovalAtomic({ approvalId: pre.approvalId!, userId: f.userId, decision: "APPROVED" });
  const destination = await f.campaign("Pre-cutover Correction");
  await correct(f, pre, { action: "MODIFIED", proposedEventCodeId: destination.eventCodeId, proposedEventCampaignId: destination.campaignId });
  await decideSignApprovalAtomic({ approvalId: pre.approvalId!, userId: f.userId, decision: "APPROVED" });
  assert.equal(await prisma.accountingJournal.count({ where: { bankTransactionId: pre.transactionId } }), 0);
  const report = await getAccountingReport(accountingQuerySchema.parse({ view: "reconciliation", from: "2026-09-01", bankAccountId: f.bankAccountId }));
  assert.equal(report.rows[0]!.state, "PRE_CUTOVER_NON_ACCOUNTED");
  const rejected = await receipt(f);
  await decideSignApprovalAtomic({ approvalId: rejected.approvalId!, userId: f.userId, decision: "REJECTED" });
  assert.equal(await prisma.accountingJournal.count({ where: { bankTransactionId: rejected.transactionId } }), 0);
}));

async function correct(f: FinancialFixture, row: Awaited<ReturnType<typeof receipt>>, change: Prisma.ReconciliationCorrectionItemUncheckedCreateWithoutProposalInput) {
  const before = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: row.transactionId } });
  await prisma.bankStatementUpload.update({ where: { id: row.statementId }, data: { status: "CHECK" } });
  await prisma.reconciliationApproval.update({ where: { id: row.approvalId! }, data: { status: "PENDING" } });
  const proposal = await prisma.reconciliationCorrectionProposal.create({ data: {
    approvalId: row.approvalId!, statementUploadId: row.statementId, status: "PENDING", proposedById: f.userId,
    approvers: { create: { userId: f.userId } }, items: { create: { bankTransactionId: row.transactionId,
      beforeEventCodeId: before.eventCodeId, proposedEventCodeId: before.eventCodeId,
      beforeEventCampaignId: before.eventCampaignId, proposedEventCampaignId: before.eventCampaignId,
      beforeRemark: before.remark, proposedRemark: before.remark, ...change } }
  }, include: { items: true } });
  return proposal;
}

test("Accounting approved Event/Campaign corrections append old/new snapshots and remark creates no GL", async () => scenario(async f => {
  const row = await receipt(f);
  await prisma.bankTransaction.update({ where: { id: row.transactionId }, data: { originalAmount: "100123.00" } });
  await decideSignApprovalAtomic({ approvalId: row.approvalId!, userId: f.userId, decision: "APPROVED" });
  const original = await prisma.accountingJournal.findFirstOrThrow({ where: { bankTransactionId: row.transactionId }, include: { lines: true } });
  const destination = await f.campaign("Reclassification Destination", "999999.99");
  const first = await correct(f, row, { action: "MODIFIED", proposedEventCodeId: destination.eventCodeId, proposedEventCampaignId: destination.campaignId });
  const query = accountingQuerySchema.parse({ view: "pending", from: "2026-11-01", bankAccountId: f.bankAccountId });
  const count = await prisma.accountingJournal.count({ where: { bankTransactionId: row.transactionId } });
  const preview = await getAccountingReport(query);
  assert.equal(preview.rows[0]!.previewDebitAccount, "4110");
  assert.equal(await prisma.accountingJournal.count({ where: { bankTransactionId: row.transactionId } }), count);
  await decideSignApprovalAtomic({ approvalId: row.approvalId!, userId: f.userId, decision: "APPROVED" });
  const journal = await prisma.accountingJournal.findUniqueOrThrow({ where: { sourceEventKey: `CORRECTION_RECLASSIFICATION:${first.items[0]!.id}` }, include: { lines: true } });
  assert.equal(journal.relatedJournalId, original.id);
  assert.ok(journal.lines.every(l => l.accountCodeSnapshot === "4110"));
  assert.equal(journal.lines.find(l => l.debit.greaterThan(0))!.eventCodeId, row.eventCodeId);
  assert.equal(journal.lines.find(l => l.credit.greaterThan(0))!.eventCampaignId, destination.campaignId);
  const secondCampaignId = await prisma.eventCampaign.create({ data: { eventCodeId: destination.eventCodeId, campaignName: "Synthetic Other Campaign" } }).then(c => c.id);
  f.campaignIds.push(secondCampaignId);
  await correct(f, row, { action: "MODIFIED", proposedEventCampaignId: secondCampaignId });
  await decideSignApprovalAtomic({ approvalId: row.approvalId!, userId: f.userId, decision: "APPROVED" });
  await correct(f, row, { action: "MODIFIED", proposedRemark: "Only remark changed" });
  await decideSignApprovalAtomic({ approvalId: row.approvalId!, userId: f.userId, decision: "APPROVED" });
  assert.equal(await prisma.accountingJournal.count({ where: { bankTransactionId: row.transactionId } }), 3);
  const saved = await prisma.accountingJournal.findUniqueOrThrow({ where: { id: original.id }, include: { lines: true } });
  assert.deepEqual(saved, original);
  const trial = await getAccountingReport(accountingQuerySchema.parse({ view: "trial", from: "2026-11-01", bankAccountId: f.bankAccountId }));
  assert.equal(trial.balanced, true);
  assert.equal(trial.rows.find(r => String(r.account).startsWith("4110"))!.movementBalance, "-100123.00");
  const oldLedger = await getAccountingReport(accountingQuerySchema.parse({ view: "ledger", from: "2026-11-01", eventCodeId: row.eventCodeId, accountCode: "4110" }));
  assert.equal(oldLedger.movementBalance, "0.00");
  const newMonthly = await getAccountingReport(accountingQuerySchema.parse({ view: "monthly", from: "2026-11-01", eventCampaignId: secondCampaignId }));
  assert.equal(newMonthly.rows[0]!.revenue, "100123.00");
}));

test("Accounting exclusion and manual additions keep operational finalization and expose review", async () => scenario(async f => {
  const row = await receipt(f);
  await decideSignApprovalAtomic({ approvalId: row.approvalId!, userId: f.userId, decision: "APPROVED" });
  await correct(f, row, { action: "EXCLUDED", correctionReason: "Synthetic exclusion" });
  await decideSignApprovalAtomic({ approvalId: row.approvalId!, userId: f.userId, decision: "APPROVED" });
  for (const amount of ["10.00", "-10.00"]) {
    const proposal = await correct(f, row, { action: "ADDED", bankTransactionId: null, manualTransactionDate: new Date("2026-11-01"),
      manualTransactionType: amount.startsWith("-") ? "DB" : "CR", manualOriginalAmount: amount,
      manualDescription: "Synthetic manual evidence", proposedEventCodeId: amount.startsWith("-") ? null : row.eventCodeId,
      proposedEventCampaignId: null });
    const preview = await getAccountingReport(accountingQuerySchema.parse({ view: "pending", from: "2026-11-01", bankAccountId: f.bankAccountId }));
    assert.equal(preview.additions.length, 1);
    assert.equal(preview.additions[0]!.state, "ACCOUNTING_REVIEW_REQUIRED");
    assert.equal("sourceEventKey" in preview.additions[0]!, false);
    await decideSignApprovalAtomic({ approvalId: row.approvalId!, userId: f.userId, decision: "APPROVED" });
    const added = await prisma.reconciliationCorrectionItem.findUniqueOrThrow({ where: { id: proposal.items[0]!.id } });
    f.transactionIds.push(added.bankTransactionId!);
  }
  const report = await getAccountingReport(accountingQuerySchema.parse({ view: "reconciliation", from: "2026-11-01", bankAccountId: f.bankAccountId }));
  assert.equal(report.rows.length, 3);
  assert.ok(report.rows.every(r => r.state === "ACCOUNTING_REVIEW_REQUIRED"));
  assert.equal(await prisma.accountingJournal.count({ where: { bankTransaction: { is: { statementUploadId: row.statementId } } } }), 1);
  assert.equal((await prisma.bankStatementUpload.findUniqueOrThrow({ where: { id: row.statementId } })).status, "FINALIZED");
}));

test("Accounting reports and Excel/PDF exports share journal evidence, exact totals and accounting month", async () => scenario(async f => {
  const row = await receipt(f);
  const pendingQuery = accountingQuerySchema.parse({ view: "pending", from: "2026-11-01", bankAccountId: f.bankAccountId });
  const preview = await getAccountingReport(pendingQuery);
  assert.equal(preview.rows[0]!.state, "PREVIEW_NOT_POSTED");
  assert.equal(await prisma.accountingJournal.count({ where: { bankTransactionId: row.transactionId } }), 0);
  await decideSignApprovalAtomic({ approvalId: row.approvalId!, userId: f.userId, decision: "APPROVED" });
  const q = accountingQuerySchema.parse({ view: "ledger", from: "2026-11-01", bankAccountId: f.bankAccountId });
  const report = await getAccountingReport(q);
  assert.equal(report.rows.length, 2);
  assert.equal(report.totalDebit, "100123.01");
  assert.equal(report.totalCredit, "100123.01");
  const monthly = await getAccountingReport({ ...q, view: "monthly" });
  assert.equal(monthly.rows[0]!.month, "2026-11");
  assert.equal(monthly.rows[0]!.revenue, "100123.01");
  const xlsx = await exportAccountingReport(q, f.userId);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx.buffer as never);
  assert.equal(workbook.worksheets[0]!.getCell("B4").value, report.totalDebit);
  assert.equal(workbook.worksheets[1]!.rowCount, 3);
  const pdf = await exportAccountingReport({ ...q, format: "pdf" }, f.userId);
  assert.equal(pdf.buffer.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.buffer.toString().includes(report.totalDebit));
  assert.ok(pdf.buffer.toString().includes("Accounting - ledger"));
}));

test("Accounting unresolved pending receipts require review without invented posting identities", async () => scenario(async f => {
  const row = await receipt(f);
  await prisma.bankTransaction.update({ where: { id: row.transactionId }, data: { eventCodeId: null } });
  const report = await getAccountingReport(accountingQuerySchema.parse({ view: "pending", from: "2026-11-01", bankAccountId: f.bankAccountId }));
  assert.equal(report.rows[0]!.state, "ACCOUNTING_REVIEW_REQUIRED");
  assert.equal(report.rows[0]!.previewDebit, null);
  assert.equal("sourceEventKey" in report.rows[0]!, false);
  assert.equal("journalNumber" in report.rows[0]!, false);
  assert.equal(await prisma.accountingJournal.count({ where: { bankTransactionId: row.transactionId } }), 0);
}));

test("Accounting all four Carry paths, permitted/blocked reversals and coverage leave original journals unchanged", async () => scenario(async f => {
  const memberId = await f.member("Accounting Carry Donor");
  const time = await receipt(f, "TIME_BASED");
  const campaign = await receipt(f, "CAMPAIGN");
  // Establish overflow before operational approval; replay never reallocates an existing receipt.
  await prisma.eventCampaign.update({ where: { id: campaign.campaignId }, data: { targetAmount: "100.00" } });
  for (const row of [time, campaign]) {
    const tx = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: row.transactionId } });
    await prisma.memberIdentity.update({ where: { id: tx.memberIdentityId! }, data: { memberId, verificationStatus: "VERIFIED" } });
    await decideSignApprovalAtomic({ approvalId: row.approvalId!, userId: f.userId, decision: "APPROVED" });
  }
  const subscription = await prisma.memberEventSubscription.findFirstOrThrow({ where: { memberId, eventCodeId: time.eventCodeId } });
  const destinationEvent = await f.campaign("Carry Time Destination");
  await prisma.eventCode.update({ where: { id: destinationEvent.eventCodeId }, data: { eventType: "TIME_BASED" } });
  await prisma.eventTimeRule.create({ data: { eventCodeId: destinationEvent.eventCodeId, unitAmount: "10.00", durationMonths: 1 } });
  const destination = await prisma.memberEventSubscription.create({ data: { memberId, eventCodeId: destinationEvent.eventCodeId } });
  const destinationCampaign = await f.campaign("Carry Campaign Destination");
  const original = await prisma.accountingJournal.findMany({ where: { bankTransactionId: { in: [time.transactionId, campaign.transactionId] } }, include: { lines: true }, orderBy: { id: "asc" } });
  for (const [sourceType, destinationType] of [["TIME_BASED", "TIME_BASED"], ["TIME_BASED", "CAMPAIGN"], ["CAMPAIGN", "TIME_BASED"], ["CAMPAIGN", "CAMPAIGN"]]) {
    const input = { amount: "10.00", reason: "Synthetic Accounting no-GL verification", idempotencyKey: randomUUID(),
      ...(destinationType === "TIME_BASED" ? { destinationSubscriptionId: destination.id } : { destinationCampaignId: destinationCampaign.campaignId }) };
    const result = sourceType === "TIME_BASED"
      ? await createCarryTransfer(memberId, subscription.id, input, f.userId)
      : await createCampaignWalletTransfer(memberId, campaign.campaignId, input, f.userId);
    const reversal = () => reverseCarryTransfer(memberId, result.transfer.transferId, { reason: "Synthetic reversal", idempotencyKey: randomUUID() }, f.userId);
    // TIME_BASED destinations have consumed this transfer into coverage. Preserve the operational dependency guard.
    if (destinationType === "TIME_BASED") await assert.rejects(reversal, /Later balance actions|no longer has enough carry/);
    else await reversal();
    assert.equal(await prisma.accountingJournal.count({ where: { bankTransactionId: { in: [time.transactionId, campaign.transactionId] } } }), 2);
  }
  assert.deepEqual(await prisma.accountingJournal.findMany({ where: { bankTransactionId: { in: [time.transactionId, campaign.transactionId] } }, include: { lines: true }, orderBy: { id: "asc" } }), original);
}));

test("Accounting Member verification, move and detach never add or rewrite journal evidence", async () => scenario(async f => {
  const row = await receipt(f);
  await decideSignApprovalAtomic({ approvalId: row.approvalId!, userId: f.userId, decision: "APPROVED" });
  const original = await prisma.accountingJournal.findMany({ where: { bankTransactionId: row.transactionId }, include: { lines: true } });
  const memberId = await f.member("Accounting First Owner");
  const otherMember = await f.member("Accounting New Owner");
  const bankTx = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: row.transactionId } });
  await prisma.memberIdentity.update({ where: { id: bankTx.memberIdentityId! }, data: { memberId, verificationStatus: "VERIFIED" } });
  await moveIdentity(memberId, bankTx.memberIdentityId!, otherMember, "Synthetic move", f.userId);
  await detachIdentity(otherMember, bankTx.memberIdentityId!, "Synthetic detach", f.userId);
  assert.deepEqual(await prisma.accountingJournal.findMany({ where: { bankTransactionId: row.transactionId }, include: { lines: true } }), original);
}));

test("Accounting backend report, preview, detail and export require the same active PAGE grant", async () => scenario(async f => {
  process.env.JWT_SECRET ??= "accounting-integration-only-secret";
  const { app } = await import("../../src/app.js");
  const { env } = await import("../../src/config/env.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const headers = { Authorization: `Bearer ${jwt.sign({ sub: f.userId }, env.jwtSecret)}` };
  const url = `http://127.0.0.1:${address.port}/api/accounting`;
  const roleId = randomUUID();
  try {
    for (const path of ["/reports?view=journals", "/reports?view=pending", "/export", `/journals/${randomUUID()}`, "/options"]) {
      assert.equal((await fetch(url + path, { headers })).status, 403);
    }
    const menu = await prisma.menu.findFirstOrThrow({ where: { menuCode: "ACCOUNTING_REPORT" } });
    await prisma.role.create({ data: { id: roleId, roleCode: `T-${roleId}`, roleName: "Accounting Test Access",
      roleMenus: { create: { menuId: menu.id } }, userRoles: { create: { userId: f.userId } } } });
    assert.equal((await fetch(url + "/reports?view=trial&from=2026-11-01", { headers })).status, 200);
    const exported = await fetch(url + "/export?view=trial&from=2026-11-01", { headers });
    assert.equal(exported.status, 200);
    assert.equal(exported.headers.get("Access-Control-Expose-Headers"), "Content-Disposition");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    await prisma.roleMenu.deleteMany({ where: { roleId } });
    await prisma.userRole.deleteMany({ where: { roleId } });
    await prisma.role.deleteMany({ where: { id: roleId } });
  }
}));
