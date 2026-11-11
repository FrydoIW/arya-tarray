import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../src/lib/prisma.js";
import { accountingCents } from "../../src/modules/accounting/accounting.domain.js";
import { centsToDecimal } from "../../src/lib/money.js";
import { scheduleScenario, ScheduleFixture } from "./schedule-fixture.js";
import { createAccrual, createAccrualAdjustment, getAccrual, requestAccrualReversal, updateAccrual } from "../../src/modules/accounting/schedules/accrual.service.js";
import { createSchedule, getSchedule, previewSchedule } from "../../src/modules/accounting/schedules/schedule.service.js";
import { applyStage23Source, dueReversals, submitAccrual, submitScheduleCommand, submitSchedulePeriod } from "../../src/modules/accounting/schedules/schedule.workflow.js";
import { applyApprovedAction, decideApproval, postApprovedJournal, postApprovedJournalInTransaction, submitApproval } from "../../src/modules/accounting/approval/approval.service.js";
import { createDocument, getDocument, postSource, requestSourceReversal, submitSource } from "../../src/modules/accounting/apar/apar.service.js";
import { postLedgerJournalInTransaction } from "../../src/modules/accounting/ledger/ledger.service.js";
async function gl(f: ScheduleFixture, id: string) {
  const row = await prisma.accountingJournalLine.aggregate({ where: { accountId: id, journal: { is: { postedById: { in: f.approval.actorIds } } } }, _sum: { debit: true, credit: true } });
  return centsToDecimal(accountingCents(row._sum.debit ?? "0") - accountingCents(row._sum.credit ?? "0"));
}
async function reverseJournal(f: ScheduleFixture, id: string, accountingDate = "2026-12-31") {
  const req = await submitApproval(f.actor, { kind: "JOURNAL_REVERSAL", sourceDocumentId: id, accountingDate, remark: "Synthetic TEST independently reviewed correction" });
  await f.approve(req.id); return postApprovedJournal(f.poster, req.id);
}

for (const kind of ["ACCRUED_EXPENSE", "ACCRUED_INCOME"] as const) test(`${kind} posts exact balance and AP/AR clears it without second expense/revenue`, async () => scheduleScenario(async f => {
  const expense = kind === "ACCRUED_EXPENSE", a = await f.accrual(f.accrualInput(kind)); assert.ok(a.journal);
  assert.equal(await gl(f, expense ? f.expense : f.revenue), expense ? "1000000.00" : "-1000000.00");
  const side = expense ? "PAYABLE" : "RECEIVABLE", cp = await f.counterparty(side), control = await f.extraAccount(expense ? "LIABILITY" : "ASSET");
  const input = f.documentInput(side, cp, "1000000.00"); input.accrualDraftId = a.doc.id; input.controlAccountId = control;
  input.lines[0].accountingAccountId = expense ? f.apControl : f.arControl;
  const doc = await createDocument(f.actor, side, input), req = await submitSource(f.actor, side, "DOCUMENT", doc.id, 1);
  await f.approve(req.id); await postSource(f.poster, side, "DOCUMENT", doc.id, req.id);
  assert.equal((await getAccrual(f.actor, a.doc.id)).remaining, "0.00");
  assert.equal((await getAccrual(f.actor, a.doc.id)).controlReconciliation.reconciled, true);
  assert.equal(await gl(f, expense ? f.apControl : f.arControl), "0.00");
  assert.equal(await gl(f, expense ? f.expense : f.revenue), expense ? "1000000.00" : "-1000000.00");
  await f.settlement(side, f.settlementInput(cp, [{ accountingDocumentId: doc.id, allocatedAmount: "300000.00" }], "300000.00"));
  assert.equal((await getDocument(f.actor, side, doc.id)).outstanding, "700000.00");
  await f.settlement(side, f.settlementInput(cp, [{ accountingDocumentId: doc.id, allocatedAmount: "700000.00" }], "700000.00"));
  assert.equal((await getDocument(f.actor, side, doc.id)).outstanding, "0.00");
  await assert.rejects(requestAccrualReversal(f.actor, a.doc.id, "2026-11-04", "TEST unsafe reversal"));
  await assert.rejects(createDocument(f.actor, side, { ...input, documentNumber: `TEST-${randomUUID()}`, sourceReference: `TEST-${randomUUID()}` }));
}));

test("Accrued income requires explicit evidence and no operational subscription/campaign creates accruals", async () => scheduleScenario(async f => {
  const input = f.accrualInput("ACCRUED_INCOME");
  await assert.rejects(createAccrual(f.approval.outsiderId, input), { status: 403 });
  const { accrualInputSchema } = await import("../../src/modules/accounting/schedules/schedule.schema.js");
  assert.equal(accrualInputSchema.safeParse({ ...input, metadata: { ...input.metadata, policyReference: "", recognitionBasis: "promise" } }).success, false);
  const bank = await f.bankEvidence("RECEIVABLE", "100.00"); assert.ok(bank.transactionId);
  assert.equal(await prisma.accountingJournalDraft.count({ where: { sourceKind: "ACCRUAL_DOCUMENT" } }), 0);
}));

test("Accrual adjustments are separately approved, bounded and reversible with complete parent traceability", async () => scheduleScenario(async f => {
  const a = await f.accrual();
  const input = { sourceReference: `TEST-${randomUUID()}`, accountingDate: "2026-11-03", amount: "200000.00", adjustmentKind: "INCREASE" as const, reason: "Synthetic TEST new meter evidence changes estimate" };
  const adjustment = await createAccrualAdjustment(f.actor, a.doc.id, input), req = await submitAccrual(f.actor, adjustment.id, 1);
  await f.approve(req.id); const journal = await postApprovedJournal(f.poster, req.id);
  assert.equal(journal.relatedJournalId, a.journal?.id); assert.equal((await getAccrual(f.actor, a.doc.id)).remaining, "1200000.00");
  const decrease = await createAccrualAdjustment(f.actor, a.doc.id, { ...input, sourceReference: `TEST-${randomUUID()}`, adjustmentKind: "DECREASE", amount: "50000.00" });
  const decreaseRequest = await submitAccrual(f.actor, decrease.id, 1); await f.approve(decreaseRequest.id);
  const decreaseJournal = await postApprovedJournal(f.poster, decreaseRequest.id);
  assert.equal((await getAccrual(f.actor, a.doc.id)).remaining, "1150000.00"); assert.equal(await gl(f, f.expense), "1150000.00");
  await reverseJournal(f, decreaseJournal.id, "2026-11-04");
  await assert.rejects(createAccrualAdjustment(f.actor, a.doc.id, { ...input, accountingDate: "2026-11-04", sourceReference: `TEST-${randomUUID()}`, adjustmentKind: "DECREASE", amount: "1200000.01" }));
  await reverseJournal(f, journal.id, "2026-11-04"); assert.equal((await getAccrual(f.actor, a.doc.id)).remaining, "1000000.00");
  assert.ok(a.journal);
  await reverseJournal(f, a.journal.id, "2026-11-05"); assert.equal(await gl(f, f.expense), "0.00"); assert.equal((await getAccrual(f.actor, a.doc.id)).remaining, "0.00");
}));

test("Accrual revision invalidates approval; requester/self and unauthorized posting remain rejected", async () => scheduleScenario(async f => {
  const a = await f.accrual(f.accrualInput(), false);
  await assert.rejects(postApprovedJournal(f.actor, a.request.id), { status: 403 });
  await updateAccrual(f.actor, a.doc.id, { ...a.input, expectedRevision: 1, metadata: { ...a.input.metadata, recognitionBasis: "Synthetic TEST revised recognition evidence" } });
  await assert.rejects(postApprovedJournal(f.poster, a.request.id));
  const req = await submitAccrual(f.actor, a.doc.id, 2);
  await assert.rejects(decideApproval(f.actor, req.id, "APPROVED", null), { status: 403 });
  await f.approve(req.id); await postApprovedJournal(f.poster, req.id);
}));

test("Scheduled reversal executes only an explicitly marked source/date, preserves original and cannot repeat", async () => scheduleScenario(async f => {
  const input = f.accrualInput(); input.metadata.scheduledReversalOn = "2026-12-01";
  const a = await f.accrual(input); assert.ok(a.journal);
  assert.equal((await dueReversals(f.actor, "2026-11-30", 1, 25)).rows.length, 0);
  assert.equal((await dueReversals(f.actor, "2026-12-01", 1, 25)).rows[0]?.id, a.doc.id);
  const req = await requestAccrualReversal(f.actor, a.doc.id, undefined, "TEST opted-in December reversal", true);
  await f.approve(req.id); const reversal = await postApprovedJournal(f.poster, req.id);
  assert.equal(reversal.accountingDate.toISOString().slice(0, 10), "2026-12-01"); assert.equal(reversal.reversalOfJournalId, a.journal.id);
  assert.equal(await gl(f, f.expense), "0.00"); assert.ok(await prisma.accountingJournal.findUnique({ where: { id: a.journal.id } }));
  await assert.rejects(requestAccrualReversal(f.actor, a.doc.id, undefined, "TEST duplicate", true));
  const unmarked = await f.accrual(); await assert.rejects(requestAccrualReversal(f.actor, unmarked.doc.id, undefined, "TEST unmarked", true));
}));

for (const kind of ["PREPAYMENT", "DEFERRED_INCOME"] as const) test(`${kind} source, partial cash settlement and monthly completion share GL without double cash/recognition`, async () => scheduleScenario(async f => {
  const source = await f.source(kind), schedule = await f.schedule(f.scheduleInput(kind, source.line.id));
  const side = kind === "PREPAYMENT" ? "PAYABLE" : "RECEIVABLE";
  await f.settlement(side, f.settlementInput(source.cp, [{ accountingDocumentId: source.doc.id, allocatedAmount: "3000000.00" }], "3000000.00"));
  assert.equal((await getSchedule(f.actor, schedule.id)).remaining, "12000000.00");
  const first = schedule.revFkAccSchedulePeriodParent[0], second = schedule.revFkAccSchedulePeriodParent[1]; assert.ok(first && second);
  if (kind === "DEFERRED_INCOME") await assert.rejects(submitSchedulePeriod(f.actor, first.id, 1), /explicit evidence/);
  await assert.rejects(f.recognize(second.id), /earlier schedule periods/);
  await f.recognize(first.id); assert.equal((await getSchedule(f.actor, schedule.id)).remaining, "6000000.00");
  await f.recognize(second.id); const completed = await getSchedule(f.actor, schedule.id);
  assert.equal(completed.status, "COMPLETED"); assert.equal(completed.remaining, "0.00"); assert.equal(completed.recognized, "12000000.00");
  assert.equal(completed.controlReconciliation.reconciled, true);
  assert.equal(await gl(f, kind === "PREPAYMENT" ? f.arControl : f.apControl), "0.00");
  assert.equal(await gl(f, kind === "PREPAYMENT" ? f.expense : f.revenue), kind === "PREPAYMENT" ? "12000000.00" : "-12000000.00");
  assert.equal(await gl(f, f.bankGl), kind === "PREPAYMENT" ? "-3000000.00" : "3000000.00");
  await assert.rejects(f.recognize(first.id));
}));

test("Prepaid actual-day partial periods round exactly and custom plans retain explicit evidence", async () => scheduleScenario(async f => {
  const source = await f.source("PREPAYMENT", "47.00"), input = { ...f.scheduleInput("PREPAYMENT", source.line.id, "47.00"), allocationMethod: "ACTUAL_DAYS" as const };
  const schedule = await f.schedule(input); assert.deepEqual(schedule.revFkAccSchedulePeriodParent.map(p => p.plannedAmount.toFixed(2)), ["16.00", "31.00"]);
  for (const period of schedule.revFkAccSchedulePeriodParent) await f.recognize(period.id);
  assert.equal((await getSchedule(f.actor, schedule.id)).remaining, "0.00");
  const other = await f.source("PREPAYMENT", "100.00"), custom = f.scheduleInput("PREPAYMENT", other.line.id, "100.00");
  custom.allocationMethod = "CUSTOM"; custom.customPeriods = schedule.revFkAccSchedulePeriodParent.map((p, i) => ({ accountingPeriodId: p.accountingPeriodId,
    recognitionDate: i === 0 ? "2026-11-20" : "2026-12-20", plannedAmount: i === 0 ? "33.33" : "66.67" }));
  const row = await f.schedule(custom); assert.equal(row.revFkAccSchedulePeriodParent[0]?.recognitionDate.toISOString().slice(0, 10), "2026-11-20");
}));

test("Schedule requires reviewed policy, real unreversed balance, no excess source allocation or future period invention", async () => scheduleScenario(async f => {
  const source = await f.source("PREPAYMENT"), input = f.scheduleInput("PREPAYMENT", source.line.id);
  const schedule = await f.schedule(input, false); assert.equal((await getSchedule(f.actor, schedule.id)).policyStatus, "PENDING_INDEPENDENT_REVIEW");
  await assert.rejects(f.recognize(schedule.revFkAccSchedulePeriodParent[0].id));
  await assert.rejects(createSchedule(f.actor, { ...input, scheduleReference: `TEST-${randomUUID()}`, amount: "0.01" }));
  await assert.rejects(createSchedule(f.actor, { ...input, scheduleReference: `TEST-${randomUUID()}`, sourceJournalLineId: randomUUID() }));
  await assert.rejects(previewSchedule(f.actor, { amount: "100.00", startDate: "2026-11-15", endDate: "2027-01-31", allocationMethod: "MONTHLY_EQUAL" }));
  assert.equal(await prisma.accountingPeriod.count(), 3);
}));

test("Concurrent schedule period execution commits exactly one balanced journal and one application", async () => scheduleScenario(async f => {
  const source = await f.source("PREPAYMENT"), schedule = await f.schedule(f.scheduleInput("PREPAYMENT", source.line.id));
  const first = schedule.revFkAccSchedulePeriodParent[0], pending = await f.recognize(first.id, 1, false);
  const results = await Promise.allSettled([postApprovedJournal(f.poster, pending.req.id), postApprovedJournal(f.poster, pending.req.id)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await prisma.accountingJournal.count({ where: { sourceKind: "SCHEDULE_RECOGNITION", sourceReference: first.id } }), 1);
  assert.equal(await prisma.accountingApprovalHistory.count({ where: { approvalRequestId: pending.req.id, action: "APPLY" } }), 1);
  assert.equal((await getSchedule(f.actor, schedule.id)).recognized, "6000000.00");
}));

test("Approved schedule reallocation supersedes stale period approvals and preserves total/posted evidence", async () => scheduleScenario(async f => {
  const source = await f.source("PREPAYMENT"), schedule = await f.schedule(f.scheduleInput("PREPAYMENT", source.line.id));
  const first = schedule.revFkAccSchedulePeriodParent[0], pending = await f.recognize(first.id, 1, false);
  await f.command(schedule.id, 1, { action: "CHANGE", reason: "Synthetic TEST revised service evidence", periods: schedule.revFkAccSchedulePeriodParent.map((p, i) => ({
    accountingPeriodId: p.accountingPeriodId, recognitionDate: p.recognitionDate.toISOString().slice(0, 10), plannedAmount: i === 0 ? "8000000.00" : "4000000.00" })) });
  await assert.rejects(postApprovedJournal(f.poster, pending.req.id));
  assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: pending.req.id } })).status, "SUPERSEDED");
  await f.recognize(first.id, 2); assert.equal((await getSchedule(f.actor, schedule.id)).remaining, "4000000.00");
}));

test("Closed period rejects recognition and scheduled reversal without consuming approval or silently changing dates", async () => scheduleScenario(async f => {
  const source = await f.source("PREPAYMENT"), schedule = await f.schedule(f.scheduleInput("PREPAYMENT", source.line.id));
  const pending = await f.recognize(schedule.revFkAccSchedulePeriodParent[0].id, 1, false);
  const input = f.accrualInput(); input.metadata.scheduledReversalOn = "2026-11-04"; const a = await f.accrual(input);
  const rev = await requestAccrualReversal(f.actor, a.doc.id, undefined, "TEST scheduled", true); await f.approve(rev.id);
  const period = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: "2026-11" } });
  try {
    await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: "CLOSED", closedAt: new Date() } });
    await assert.rejects(postApprovedJournal(f.poster, pending.req.id), /open accounting period/);
    await assert.rejects(postApprovedJournal(f.poster, rev.id), /open accounting period/);
    assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: pending.req.id } })).status, "APPROVED");
  } finally { await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: period.status, closedAt: period.closedAt } }); }
}));

test("Posting failures roll back accrual, schedule period, completion state and approval history", async () => scheduleScenario(async f => {
  const a = await f.accrual(f.accrualInput(), false), marker = new Error("TEST Stage23 failure");
  await assert.rejects(prisma.$transaction(async tx => { await postApprovedJournalInTransaction(tx, f.poster, a.request.id); throw marker; }), e => e === marker);
  assert.equal((await prisma.accountingJournalDraft.findUniqueOrThrow({ where: { id: a.doc.id } })).status, "DRAFT");
  const source = await f.source("PREPAYMENT"), input = f.scheduleInput("PREPAYMENT", source.line.id); input.endDate = "2026-11-30";
  const schedule = await f.schedule(input), pending = await f.recognize(schedule.revFkAccSchedulePeriodParent[0].id, 1, false);
  await assert.rejects(prisma.$transaction(async tx => { await postApprovedJournalInTransaction(tx, f.poster, pending.req.id); throw marker; }), e => e === marker);
  const state = await getSchedule(f.actor, schedule.id); assert.equal(state.status, "ACTIVE"); assert.equal(state.remaining, "12000000.00");
  assert.equal(state.revFkAccSchedulePeriodParent[0].recognitionJournalId, null);
  assert.equal(await prisma.accountingApprovalHistory.count({ where: { approvalRequestId: pending.req.id, action: "APPLY" } }), 0);
}));

test("Early termination requires independent approval and recognizes exact remaining balance without another cash entry", async () => scheduleScenario(async f => {
  const source = await f.source("PREPAYMENT"), schedule = await f.schedule(f.scheduleInput("PREPAYMENT", source.line.id));
  await f.recognize(schedule.revFkAccSchedulePeriodParent[0].id);
  const req = await submitScheduleCommand(f.actor, schedule.id, 1, { action: "TERMINATE", accountingDate: "2026-12-02", reason: "Synthetic TEST approved termination loss evidence" });
  await assert.rejects(postApprovedJournal(f.poster, req.id)); await f.approve(req.id); const journal = await postApprovedJournal(f.poster, req.id);
  const state = await getSchedule(f.actor, schedule.id); assert.equal(state.status, "TERMINATED"); assert.equal(state.terminated, "6000000.00"); assert.equal(state.remaining, "0.00");
  assert.equal(await gl(f, f.arControl), "0.00"); assert.equal(await gl(f, f.bankGl), "0.00");
  await reverseJournal(f, journal.id); const reversed = await getSchedule(f.actor, schedule.id);
  assert.equal(reversed.status, "CANCELLED"); assert.equal(reversed.remaining, "6000000.00");
}));

test("Schedule cancellation keeps unamortized GL balance and releases only unused source capacity", async () => scheduleScenario(async f => {
  const source = await f.source("PREPAYMENT"), schedule = await f.schedule(f.scheduleInput("PREPAYMENT", source.line.id));
  await f.recognize(schedule.revFkAccSchedulePeriodParent[0].id);
  await f.command(schedule.id, 1, { action: "CANCEL", reason: "Synthetic TEST service allocation replaced" });
  assert.equal((await getSchedule(f.actor, schedule.id)).remaining, "6000000.00"); assert.equal(await gl(f, f.arControl), "6000000.00");
  const next = await f.schedule({ ...f.scheduleInput("PREPAYMENT", source.line.id, "6000000.00"), startDate: "2026-12-01" });
  assert.equal(next.plannedAmount.toFixed(2), "6000000.00");
}));

test("Source journal reversal is blocked by schedules; recognition reversal preserves original and cancels future execution", async () => scheduleScenario(async f => {
  const source = await f.source("PREPAYMENT"), schedule = await f.schedule(f.scheduleInput("PREPAYMENT", source.line.id));
  await assert.rejects(requestSourceReversal(f.actor, "PAYABLE", "DOCUMENT", source.doc.id, { accountingDate: "2026-12-31", remark: "TEST unsafe source reversal" }));
  const recognized = await f.recognize(schedule.revFkAccSchedulePeriodParent[0].id); assert.ok(recognized.journal);
  await reverseJournal(f, recognized.journal.id); assert.equal((await getSchedule(f.actor, schedule.id)).status, "CANCELLED");
  assert.ok(await prisma.accountingJournal.findUnique({ where: { id: recognized.journal.id } }));
  assert.equal(await gl(f, f.arControl), "12000000.00");
  await assert.rejects(f.recognize(schedule.revFkAccSchedulePeriodParent[1].id, 2));
  const req = await requestSourceReversal(f.actor, "PAYABLE", "DOCUMENT", source.doc.id, { accountingDate: "2026-12-31", remark: "TEST safe source reversal after recognition cancelled" });
  await f.applyReversal(req); assert.equal(await gl(f, f.arControl), "0.00");
}));

test("Stage23 common posting gate rejects approval bypass and HTTP routes enforce auth/permissions and validated preview", async () => scheduleScenario(async f => {
  await assert.rejects(prisma.$transaction(tx => postLedgerJournalInTransaction(tx, { journalType: "ACCRUAL", sourceKind: "ACCRUAL_DOCUMENT",
    sourceReference: randomUUID(), accountingDate: new Date("2026-11-02"), postedById: f.poster, descriptionSnapshot: "TEST bypass",
    lines: [{ accountId: f.expense, debit: "100.00", credit: "0.00" }, { accountId: f.apControl, debit: "0.00", credit: "100.00" }] })), /persisted Accounting approval/);
  const { app } = await import("../../src/app.js"), { env } = await import("../../src/config/env.js");
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/accounting`;
  const call = (actor: string, route: string, body?: unknown, method = "POST") => fetch(url + route, { method,
    headers: { Authorization: `Bearer ${jwt.sign({ sub: actor }, env.jwtSecret)}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    assert.equal((await fetch(url + "/schedules")).status, 401);
    assert.equal((await call(f.approval.outsiderId, "/accruals", f.accrualInput())).status, 403);
    const preview = await call(f.actor, "/schedules/preview", { amount: "100.00", startDate: "2026-11-15", endDate: "2026-12-31", allocationMethod: "MONTHLY_EQUAL" });
    assert.equal(preview.status, 200); assert.equal((await preview.json()).periods.length, 2);
    const response = await call(f.actor, "/accruals", f.accrualInput()); assert.equal(response.status, 201); const doc = await response.json();
    const submitted = await call(f.actor, `/accruals/${doc.id}/submit`, { expectedRevision: 1 }); assert.equal(submitted.status, 201); const req = await submitted.json();
    assert.equal((await call(f.reviewer, `/approvals/${req.id}/decision`, { decision: "APPROVED" })).status, 200);
    assert.equal((await call(f.poster, `/accruals/${doc.id}/post`, { approvalRequestId: req.id })).status, 201);
    assert.equal((await call(f.actor, `/accruals/${doc.id}`, undefined, "GET")).status, 200);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}));

test("Concurrent AP clearing claims cannot consume an accrual twice", async () => scheduleScenario(async f => {
  const a = await f.accrual(), cp = await f.counterparty(), control = await f.extraAccount("LIABILITY");
  const prepare = async () => {
    const input = f.documentInput("PAYABLE", cp, "700000.00"); input.accrualDraftId = a.doc.id; input.controlAccountId = control;
    input.lines[0].accountingAccountId = f.apControl;
    const doc = await createDocument(f.actor, "PAYABLE", input), req = await submitSource(f.actor, "PAYABLE", "DOCUMENT", doc.id, 1);
    await f.approve(req.id); return { doc, req };
  };
  const first = await prepare(), second = await prepare();
  const results = await Promise.allSettled([postSource(f.poster, "PAYABLE", "DOCUMENT", first.doc.id, first.req.id),
    postSource(f.poster, "PAYABLE", "DOCUMENT", second.doc.id, second.req.id)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await getAccrual(f.actor, a.doc.id)).remaining, "300000.00");
  assert.equal(await gl(f, f.expense), "1000000.00"); assert.equal(await gl(f, f.apControl), "-300000.00");
}));

test("A reversed termination cannot fund a new recognition before restoration date", async () => scheduleScenario(async f => {
  const source = await f.source("PREPAYMENT"), schedule = await f.schedule(f.scheduleInput("PREPAYMENT", source.line.id));
  await f.recognize(schedule.revFkAccSchedulePeriodParent[0].id);
  const terminated = await submitScheduleCommand(f.actor, schedule.id, 1, { action: "TERMINATE", accountingDate: "2026-12-02", reason: "Synthetic TEST independently reviewed loss" });
  await f.approve(terminated.id); const journal = await postApprovedJournal(f.poster, terminated.id); await reverseJournal(f, journal.id, "2026-12-31");
  const input = f.scheduleInput("PREPAYMENT", source.line.id, "6000000.00"); input.startDate = "2026-12-01"; input.endDate = "2026-12-15";
  await assert.rejects(createSchedule(f.actor, input), /cannot predate/);
}));
