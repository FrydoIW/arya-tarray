import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { prisma } from "../../src/lib/prisma.js";
import { createDraft, updateDraft, submitApproval, decideApproval, cancelApproval,
  postApprovedJournal, postApprovedJournalInTransaction, getApproval } from "../../src/modules/accounting/approval/approval.service.js";
import { postLedgerJournalInTransaction } from "../../src/modules/accounting/ledger/ledger.service.js";
import { approvalScenario, type AccountingApprovalFixture } from "./accounting-approval-fixture.js";

async function submitted(f: AccountingApprovalFixture) {
  const input = await f.input();
  const draft = await createDraft(f.requesterId, input);
  const request = await submitApproval(f.requesterId, { kind: "MANUAL_JOURNAL", sourceDocumentId: draft.id, expectedRevision: 1 });
  return { input, draft, request };
}
async function approved(f: AccountingApprovalFixture) {
  const result = await submitted(f);
  await decideApproval(f.reviewerId, result.request.id, "APPROVED", "Evidence reviewed");
  return result;
}

test("Accounting approval persists assignment, independent decision, application and immutable posted source", async () => approvalScenario(async f => {
  const { input, draft, request } = await approved(f);
  assert.deepEqual(request.approvers.map(a => a.approverUserId), [f.reviewerId]);
  const journal = await postApprovedJournal(f.posterId, request.id);
  assert.equal(journal.lines[0]?.debit.toFixed(2), "100.25");
  assert.equal(journal.lines[1]?.credit.toFixed(2), "100.25");
  assert.equal(journal.bankTransactionId, null);
  const evidence = await getApproval(f.reviewerId, request.id);
  assert.equal(evidence.status, "APPLIED");
  assert.equal(evidence.decidedById, f.reviewerId);
  assert.equal(evidence.appliedById, f.posterId);
  assert.equal(evidence.appliedJournalId, journal.id);
  assert.deepEqual(evidence.history.map(event => event.action), ["SUBMIT", "APPROVE", "APPLY"]);
  assert.equal((await prisma.accountingJournalDraft.findUniqueOrThrow({ where: { id: draft.id } })).postedJournalId, journal.id);
  await assert.rejects(updateDraft(f.requesterId, draft.id, { ...input, expectedRevision: 1 }), /cannot be edited/);
  await assert.rejects(postApprovedJournal(f.posterId, request.id));
  assert.equal(await prisma.accountingJournal.count({ where: { sourceEventKey: journal.sourceEventKey } }), 1);
}));

test("Accounting rejects unauthorized and self decisions, rejected posting and cancelled approval", async () => approvalScenario(async f => {
  const { request } = await submitted(f);
  await assert.rejects(decideApproval(f.outsiderId, request.id, "APPROVED", null), { status: 403 });
  await assert.rejects(decideApproval(f.requesterId, request.id, "APPROVED", null), { status: 403 });
  await decideApproval(f.reviewerId, request.id, "REJECTED", "Insufficient evidence");
  await assert.rejects(postApprovedJournal(f.posterId, request.id), /approval is required/);
  const second = await approved(f);
  await assert.rejects(cancelApproval(f.outsiderId, second.request.id, "Unauthorized"), { status: 403 });
  await cancelApproval(f.requesterId, second.request.id, "Withdraw the request");
  await assert.rejects(postApprovedJournal(f.posterId, second.request.id), /approval is required/);
  assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: second.request.id } })).status, "CANCELLED");
  assert.equal(await prisma.accountingJournal.count({ where: { postedById: f.posterId } }), 0);
}));

test("Accounting concurrent duplicate decisions commit exactly one decision and history event", async () => approvalScenario(async f => {
  const { request } = await submitted(f);
  const results = await Promise.allSettled([
    decideApproval(f.reviewerId, request.id, "APPROVED", "First"),
    decideApproval(f.reviewerId, request.id, "APPROVED", "Second")
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(await prisma.accountingApprovalHistory.count({ where: { approvalRequestId: request.id, action: "APPROVE" } }), 1);
}));

test("Accounting material revision supersedes approval and requires a newly approved digest", async () => approvalScenario(async f => {
  const { input, draft, request } = await approved(f);
  const revised = await updateDraft(f.requesterId, draft.id, { ...input, expectedRevision: 1,
    description: "Material supporting evidence revised" });
  assert.equal(revised.revision, 2);
  assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: request.id } })).status, "SUPERSEDED");
  await assert.rejects(postApprovedJournal(f.posterId, request.id), /no longer current/);
  const next = await submitApproval(f.requesterId, { kind: "MANUAL_JOURNAL", sourceDocumentId: draft.id, expectedRevision: 2 });
  assert.notEqual(next.sourceDigest, request.sourceDigest);
  await decideApproval(f.reviewerId, next.id, "APPROVED", null);
  await postApprovedJournal(f.posterId, next.id);
}));

test("Accounting source tampering and mismatched proposed lines cannot reuse an approval", async () => approvalScenario(async f => {
  const { input, draft, request } = await approved(f);
  const first = input.lines[0], second = input.lines[1];
  assert.ok(first && second);
  await assert.rejects(prisma.$transaction(tx => postLedgerJournalInTransaction(tx, {
    journalType: "MANUAL", sourceKind: "MANUAL_JOURNAL", sourceReference: input.sourceReference,
    accountingDate: new Date(input.accountingDate), postedById: f.posterId, descriptionSnapshot: input.description,
    lines: input.lines
  })), /persisted Accounting approval/);
  await assert.rejects(prisma.$transaction(tx => postLedgerJournalInTransaction(tx, {
    approvalRequestId: request.id, journalType: "MANUAL", sourceKind: "MANUAL_JOURNAL", sourceReference: input.sourceReference,
    accountingDate: new Date(input.accountingDate), postedById: f.posterId, descriptionSnapshot: input.description,
    lines: [{ ...first, debit: "101.00" }, { ...second, credit: "101.00" }]
  })), /does not match the approved/);
  await prisma.$transaction(async tx => {
    await tx.accountingJournalDraftLine.updateMany({ where: { journalDraftId: draft.id, lineNo: 1 }, data: { debit: "101.00" } });
    await tx.accountingJournalDraftLine.updateMany({ where: { journalDraftId: draft.id, lineNo: 2 }, data: { credit: "101.00" } });
  });
  await assert.rejects(postApprovedJournal(f.posterId, request.id), /no longer matches/);
  assert.equal(await prisma.accountingJournal.count({ where: { postedById: f.posterId } }), 0);
  assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: request.id } })).status, "APPROVED");
}));

test("Accounting posting failure rolls journal, approval application and draft state back atomically", async () => approvalScenario(async f => {
  const { draft, request } = await approved(f);
  const abort = new Error("Injected failure after posting and approval application");
  await assert.rejects(prisma.$transaction(async tx => {
    await postApprovedJournalInTransaction(tx, f.posterId, request.id);
    throw abort;
  }, { isolationLevel: "Serializable" }), error => error === abort);
  assert.equal(await prisma.accountingJournal.count({ where: { postedById: f.posterId } }), 0);
  assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: request.id } })).status, "APPROVED");
  assert.equal((await prisma.accountingJournalDraft.findUniqueOrThrow({ where: { id: draft.id } })).status, "DRAFT");
  assert.equal(await prisma.accountingApprovalHistory.count({ where: { approvalRequestId: request.id, action: "APPLY" } }), 0);
  await postApprovedJournal(f.posterId, request.id);
}));

test("Accounting approved reversal swaps exact values, retains source journal and cannot repeat", async () => approvalScenario(async f => {
  const { request } = await approved(f);
  const original = await postApprovedJournal(f.posterId, request.id);
  const before = await prisma.accountingJournal.findUniqueOrThrow({ where: { id: original.id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  const reversalRequest = await submitApproval(f.requesterId, { kind: "JOURNAL_REVERSAL",
    sourceDocumentId: original.id, accountingDate: "2026-11-03", remark: "Reverse synthetic entry" });
  await decideApproval(f.reviewerId, reversalRequest.id, "APPROVED", null);
  const reversal = await postApprovedJournal(f.posterId, reversalRequest.id);
  assert.equal(reversal.reversalOfJournalId, original.id);
  assert.equal(reversal.lines[0]?.credit.toFixed(2), "100.25");
  assert.equal(reversal.lines[1]?.debit.toFixed(2), "100.25");
  assert.deepEqual(await prisma.accountingJournal.findUniqueOrThrow({ where: { id: original.id }, include: { lines: { orderBy: { lineNo: "asc" } } } }), before);
  await assert.rejects(submitApproval(f.requesterId, { kind: "JOURNAL_REVERSAL",
    sourceDocumentId: original.id, accountingDate: "2026-11-03", remark: "Duplicate" }), /already been reversed/);
}));

test("Accounting closed period rejects approved posting without consuming approval", async () => approvalScenario(async f => {
  const { request } = await approved(f);
  const period = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: "2026-11" } });
  try {
    await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: "CLOSED", closedAt: new Date() } });
    await assert.rejects(postApprovedJournal(f.posterId, request.id), /open accounting period/);
    assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: request.id } })).status, "APPROVED");
    assert.equal(await prisma.accountingJournal.count({ where: { postedById: f.posterId } }), 0);
  } finally {
    await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: period.status, closedAt: period.closedAt } });
  }
}));

test("Accounting HTTP draft/request/decision/post routes enforce permissions, validation and audit contract", async () => approvalScenario(async f => {
  const { app } = await import("../../src/app.js");
  const { env } = await import("../../src/config/env.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/accounting`;
  const call = (actor: string, route: string, body?: unknown, method = "POST") => fetch(url + route, {
    method, headers: { Authorization: `Bearer ${jwt.sign({ sub: actor }, env.jwtSecret)}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    assert.equal((await call(f.outsiderId, "/approval-settings", undefined, "GET")).status, 403);
    assert.equal((await call(f.requesterId, "/approval-settings", { activeFlag: true, approverUserIds: [f.outsiderId] }, "PUT")).status, 400);
    assert.equal((await call(f.requesterId, "/approval-settings", { activeFlag: true, approverUserIds: [f.reviewerId] }, "PUT")).status, 200);
    assert.equal((await call(f.requesterId, "/approval-settings", undefined, "GET")).status, 200);
    const input = await f.input();
    const first = input.lines[0], second = input.lines[1];
    assert.ok(first && second);
    assert.equal((await call(f.outsiderId, "/journal-drafts", input)).status, 403);
    assert.equal((await call(f.requesterId, "/journal-drafts", { ...input, lines: [{ ...first, debit: "99.00" }, second] })).status, 400);
    const created = await call(f.requesterId, "/journal-drafts", input); assert.equal(created.status, 201);
    const draft = await created.json();
    const submittedResponse = await call(f.requesterId, "/approvals", { kind: "MANUAL_JOURNAL", sourceDocumentId: draft.id, expectedRevision: 1 });
    assert.equal(submittedResponse.status, 201); const request = await submittedResponse.json();
    assert.equal((await call(f.outsiderId, `/approvals/${request.id}/decision`, { decision: "APPROVED" })).status, 403);
    assert.equal((await call(f.requesterId, `/approvals/${request.id}/decision`, { decision: "APPROVED" })).status, 403);
    assert.equal((await call(f.reviewerId, `/approvals/${request.id}/decision`, { decision: "APPROVED", remark: "Reviewed" })).status, 200);
    assert.equal((await call(f.requesterId, `/approvals/${request.id}/post`)).status, 403);
    assert.equal((await call(f.posterId, `/approvals/${request.id}/post`)).status, 201);
    const detail = await call(f.reviewerId, `/approvals/${request.id}`, undefined, "GET");
    assert.equal(detail.status, 200); assert.equal((await detail.json()).history.length, 3);
    assert.equal((await call(f.requesterId, `/journal-drafts/${draft.id}`, { ...input, expectedRevision: 1 }, "PATCH")).status, 409);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}));
