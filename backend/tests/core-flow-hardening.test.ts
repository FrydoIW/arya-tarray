import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HttpError } from "../src/lib/http.js";
import {
  buildApprovalApproverSnapshot,
  LEGACY_APPROVAL_SNAPSHOT_MESSAGE,
  requireApprovalSnapshotMembership
} from "../src/modules/approval/sign-approval/approval-snapshot.domain.js";
import {
  statementsHaveIdenticalContent,
  type StatementContentRow
} from "../src/modules/reconciliation/statement-upload/statement-upload.duplicate.js";

test("approval snapshots preserve submission-time approvers and new submissions use new configuration", () => {
  const configuration = [{ approverUserId: "admin" }, { approverUserId: "manager" }];
  const existing = buildApprovalApproverSnapshot("approval-a", configuration);
  assert.deepEqual(existing, [
    { approvalId: "approval-a", userId: "admin" },
    { approvalId: "approval-a", userId: "manager" }
  ]);

  configuration.splice(0, configuration.length, { approverUserId: "admin" }, { approverUserId: "operator" });
  assert.deepEqual(existing.map((row) => row.userId), ["admin", "manager"]);
  assert.deepEqual(
    buildApprovalApproverSnapshot("approval-b", configuration).map((row) => row.userId),
    ["admin", "operator"]
  );
});

test("snapshot membership alone authorizes queue/detail/approve/reject callers and legacy rows fail safely", () => {
  const snapshot = [{ userId: "admin" }, { userId: "manager" }];
  assert.doesNotThrow(() => requireApprovalSnapshotMembership(snapshot, "manager"));
  assert.throws(
    () => requireApprovalSnapshotMembership(snapshot, "operator"),
    (error) => error instanceof HttpError && error.status === 403
  );
  assert.throws(
    () => requireApprovalSnapshotMembership([], "admin"),
    (error) => error instanceof HttpError && error.status === 409 && error.message === LEGACY_APPROVAL_SNAPSHOT_MESSAGE
  );
});

test("approval persistence uses immutable snapshot rows and retains conditional ANY ONE terminal transition", () => {
  const statementRepository = readFileSync(new URL("../src/modules/reconciliation/statement-upload/statement-upload.repository.ts", import.meta.url), "utf8");
  const signRepository = readFileSync(new URL("../src/modules/approval/sign-approval/sign-approval.repository.ts", import.meta.url), "utf8");
  assert.match(statementRepository, /reconciliationApprovalApprover\.createMany/);
  assert.match(statementRepository, /buildApprovalApproverSnapshot\(approvalId, approvalConfig\.approvers\)/);
  assert.doesNotMatch(signRepository, /approvalConfig/);
  assert.match(signRepository, /effectiveQueueApprovers/);
  assert.match(signRepository, /correctionProposals\[0\]\?\.approvers \?\? item\.approvers/);
  assert.equal(signRepository.match(/requireApprovalSnapshotMembership\(/g)?.length, 2);
  assert.match(signRepository, /updateMany\([\s\S]*?status: "PENDING"/);
  assert.doesNotMatch(signRepository, /approvalLevel|sequence|levelId/);
});

function statementRow(overrides: Partial<StatementContentRow> = {}): StatementContentRow {
  return {
    rowNo: 1,
    transactionDate: new Date("2026-09-09T00:00:00.000Z"),
    transactionType: "CR",
    referenceNo: "REF-1",
    senderName: "DONATUR A",
    description: "TRANSFER",
    originalAmount: "100000.00",
    ...overrides
  };
}

test("exact statement duplicate comparison ignores filename but rejects only identical parsed evidence", () => {
  const incoming = [statementRow(), statementRow({ rowNo: 2, referenceNo: "REF-2", originalAmount: "25000.00" })];
  const stored = [statementRow({ originalAmount: "100000" }), statementRow({ rowNo: 2, referenceNo: "REF-2", originalAmount: "25000" })];
  assert.equal(statementsHaveIdenticalContent(incoming, stored), true);
  assert.equal(
    statementsHaveIdenticalContent(incoming, [stored[0]!, { ...stored[1]!, referenceNo: "DIFFERENT" }]),
    false
  );
});

test("statement isolation is enforced in repository predicates and the frontend mutation path", () => {
  const repository = readFileSync(new URL("../src/modules/reconciliation/statement-upload/statement-upload.repository.ts", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../src/modules/reconciliation/statement-upload/statement-upload.routes.ts", import.meta.url), "utf8");
  assert.match(repository, /where: \{ id: input\.transactionId, statementUploadId: input\.statementId \}/);
  assert.match(repository, /where: \{ statementUploadId: statement\.id \}/);
  assert.match(routes, /\/:statementId\/transactions\/:transactionId\/final-event/);
});
