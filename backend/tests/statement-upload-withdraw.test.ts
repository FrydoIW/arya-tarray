import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { withdrawStatementSchema } from "../src/modules/reconciliation/statement-upload/statement-upload.schema.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("withdraw schema requires a trimmed non-blank reason", () => {
  assert.equal(withdrawStatementSchema.safeParse({ reason: "" }).success, false);
  assert.equal(withdrawStatementSchema.safeParse({ reason: "   " }).success, false);
  assert.equal(withdrawStatementSchema.safeParse({}).success, false);
  assert.equal(withdrawStatementSchema.safeParse({ reason: "x".repeat(1001) }).success, false);
  const parsed = withdrawStatementSchema.parse({ reason: "  duplicate upload  " });
  assert.equal(parsed.reason, "duplicate upload");
});

test("withdraw locks the bank account, flips only RAW, and writes audit fields", () => {
  const repository = read("../src/modules/reconciliation/statement-upload/statement-upload.repository.ts");
  const start = repository.indexOf("export async function withdrawStatementAtomic");
  const block = repository.slice(start);

  const lockIndex = block.indexOf("FOR UPDATE");
  const updateIndex = block.indexOf("bankStatementUpload.updateMany");
  const countIndex = block.indexOf("bankStatementUpload.count");
  const guardIndex = block.indexOf("remainingStatementCount === 0");
  const unlockIndex = block.indexOf("openingBalanceLockedAt: null");
  assert.ok(lockIndex >= 0 && updateIndex > lockIndex, "bank account lock precedes the lifecycle update");
  assert.ok(countIndex > updateIndex && guardIndex > countIndex && unlockIndex > guardIndex, "recount then conditional unlock follow the update");

  assert.match(block, /where: \{ id: statement\.id, status: "RAW" \}/);
  assert.match(block, /status: "WITHDRAWN"/);
  assert.match(block, /withdrawnAt: now/);
  assert.match(block, /withdrawnById: input\.userId/);
  assert.match(block, /withdrawalReason: reason/);
  assert.match(block, /withdrawal\.count !== 1/);
  assert.match(block, /status: \{ not: "WITHDRAWN" \}/);
  assert.match(block, /"P2034"/);
  assert.match(block, /"P2010"/);
  assert.match(block, /"1213", "1205"/);

  assert.doesNotMatch(block, /bankTransaction\.(update|updateMany|delete|deleteMany|create|createMany)/);
  assert.doesNotMatch(block, /bankStatementUploadAttempt|bankStatementUploadDuplicate/);
});

test("rejected approvals return the statement to RAW and remain withdrawable", () => {
  const approval = read("../src/modules/approval/sign-approval/sign-approval.repository.ts");
  assert.match(approval, /const statementStatus = input\.decision === "APPROVED" \? "FINALIZED" : "RAW"/);
  assert.match(approval, /status: statementStatus/);
});

test("withdrawn statements are excluded from operational queries", () => {
  const dashboard = read("../src/modules/monitoring/dashboard/dashboard.repository.ts");
  const transactionWhere = dashboard.slice(
    dashboard.indexOf("function transactionPeriodWhere"),
    dashboard.indexOf("function statementPeriodWhere")
  );
  const statementWhere = dashboard.slice(
    dashboard.indexOf("function statementPeriodWhere"),
    dashboard.indexOf("export async function loadDashboardPeriodSummary")
  );
  assert.match(transactionWhere, /statementUpload: \{ is: \{ status: \{ not: "WITHDRAWN" \} \} \}/);
  assert.match(statementWhere, /status: \{ not: "WITHDRAWN" \}/);
  assert.match(dashboard, /where: \{ status: \{ not: "WITHDRAWN" \} \}/);
  assert.match(dashboard, /transaction: \{ is: \{ statementUpload: \{ is: \{ status: \{ not: "WITHDRAWN" \} \} \} \} \}/);

  const bankAccount = read("../src/modules/configuration/bank-account/bank-account.repository.ts");
  assert.match(bankAccount, /AND bs\.status <> 'WITHDRAWN'/);
  assert.match(bankAccount, /statements: \{ where: \{ status: \{ not: "WITHDRAWN" \} \} \}/);
  assert.match(bankAccount, /statements: \{ none: \{ status: \{ not: "WITHDRAWN" \} \} \}/);

  const inquiry = read("../src/modules/reconciliation/transaction-inquiry/transaction-inquiry.repository.ts");
  assert.match(inquiry, /statementUpload: \{ is: \{ status: \{ not: "WITHDRAWN" \} \} \}/);

  const statementUpload = read("../src/modules/reconciliation/statement-upload/statement-upload.repository.ts");
  assert.match(statementUpload, /where: \{ status: "RAW" \}/);
  assert.match(statementUpload, /current\.statementUpload\.status !== "RAW"/);
  assert.match(statementUpload, /statement\.status !== "RAW"/);
  assert.match(statementUpload, /status: \{ not: "WITHDRAWN" \}/);
});

test("withdraw route and controller are dedicated", () => {
  const routes = read("../src/modules/reconciliation/statement-upload/statement-upload.routes.ts");
  const controller = read("../src/modules/reconciliation/statement-upload/statement-upload.controller.ts");
  assert.match(routes, /post\("\/:statementId\/withdraw"/);
  assert.match(controller, /withdrawStatementSchema\.parse\(req\.body \?\? \{\}\)/);
  assert.match(controller, /withdrawStatement\(statementId, input, req\.auth!\.userId\)/);
});

test("withdraw service returns workspace state with the withdrawal outcome", () => {
  const service = read("../src/modules/reconciliation/statement-upload/statement-upload.service.ts");
  assert.match(service, /withdrawStatementAtomic\(\{ statementId, reason: input\.reason, userId \}\)/);
  assert.match(service, /withdrawal: \{/);
  assert.match(service, /remainingStatementCount: result\.remainingStatementCount/);
  assert.match(service, /openingBalanceUnlocked: result\.openingBalanceUnlocked/);
});
