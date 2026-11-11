import assert from "node:assert/strict";
import test from "node:test";
import { accountingApprovalDigest, assertAccountingApprovalDecision, decideAccountingApproval,
  assertAccountingApprovalForPosting, type AccountingApprovalEvidence } from "../src/modules/accounting/approval/approval.domain.js";

const material = { header: { date: "2026-11-01", source: "MANUAL-001" },
  lines: [{ debit: "100.00", credit: "0.00" }, { debit: "0.00", credit: "100.00" }] };
const digest = accountingApprovalDigest(material);
const request: AccountingApprovalEvidence = {
  id: "request-1", kind: "MANUAL_JOURNAL", sourceDocumentId: "draft-1", sourceVersion: 1,
  sourceDigest: digest, requestedById: "creator", status: "PENDING", decidedById: null,
  approverIds: ["reviewer"]
};

test("approval digest is stable under object key order and changes with material financial edits", () => {
  assert.equal(digest, accountingApprovalDigest({ lines: material.lines,
    header: { source: "MANUAL-001", date: "2026-11-01" } }));
  assert.notEqual(digest, accountingApprovalDigest({ ...material,
    lines: [{ debit: "101.00", credit: "0.00" }, { debit: "0.00", credit: "101.00" }] }));
  assert.throws(() => accountingApprovalDigest({ amount: 100.01 }), /explicit string/);
});

test("authorized independent reviewer may grant or reject a current approval", () => {
  for (const decision of ["APPROVED", "REJECTED"] as const) {
    const result = decideAccountingApproval({ request, actorId: "reviewer", hasPermission: true,
      currentDigest: digest, decision, decidedAt: new Date("2026-11-04T00:00:00.000Z"), remark: null });
    assert.equal(result.status, decision);
    assert.equal(result.decidedById, "reviewer");
    assert.equal(result.historyAction, decision === "APPROVED" ? "APPROVE" : "REJECT");
  }
});

test("unauthorized reviewer, self-review, stale version and duplicate decisions fail closed", () => {
  const base = { request, actorId: "reviewer", hasPermission: true, currentDigest: digest,
    decision: "APPROVED" as const };
  assert.throws(() => assertAccountingApprovalDecision({ ...base, actorId: "stranger" }), /not an authorized/);
  assert.throws(() => assertAccountingApprovalDecision({ ...base, hasPermission: false }), /not an authorized/);
  assert.throws(() => assertAccountingApprovalDecision({ ...base, request: { ...request,
    approverIds: ["creator"] }, actorId: "creator" }), /own Accounting request/);
  assert.throws(() => assertAccountingApprovalDecision({ ...base, currentDigest: "changed" }), /changed after/);
  assert.throws(() => assertAccountingApprovalDecision({ ...base, request: { ...request,
    status: "APPROVED" } }), /already been decided/);
  assert.throws(() => assertAccountingApprovalDecision({ ...base, request: { ...request,
    status: "REJECTED" } }), /already been decided/);
});

test("posting requires matching approved source, version, digest and separate approver", () => {
  const approved: AccountingApprovalEvidence = { ...request, status: "APPROVED", decidedById: "reviewer" };
  const base = { request: approved, kind: "MANUAL_JOURNAL" as const, sourceDocumentId: "draft-1",
    sourceVersion: 1, currentDigest: digest, hasPostingPermission: true };
  assert.doesNotThrow(() => assertAccountingApprovalForPosting(base));
  assert.throws(() => assertAccountingApprovalForPosting({ ...base, hasPostingPermission: false }), /permission/);
  for (const status of ["REJECTED", "CANCELLED", "SUPERSEDED", "APPLIED"] as const) {
    assert.throws(() => assertAccountingApprovalForPosting({ ...base,
      request: { ...approved, status } }), /independent, current/);
  }
  assert.throws(() => assertAccountingApprovalForPosting({ ...base,
    request: { ...approved, decidedById: "creator" } }), /independent, current/);
  assert.throws(() => assertAccountingApprovalForPosting({ ...base,
    request: { ...approved, approverIds: [] } }), /independent, current/);
  assert.throws(() => assertAccountingApprovalForPosting({ ...base, sourceVersion: 2 }), /no longer matches/);
  assert.throws(() => assertAccountingApprovalForPosting({ ...base, currentDigest: "changed" }), /no longer matches/);
});
