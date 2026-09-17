import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveRemarkUpdate } from "../src/modules/reconciliation/statement-upload/statement-upload.repository.js";

const repository = () => readFileSync(new URL("../src/modules/reconciliation/statement-upload/statement-upload.repository.ts", import.meta.url), "utf8");

function finalEventBlock() {
  const source = repository();
  const start = source.indexOf("export async function updateTransactionFinalEventAtomic");
  const end = source.indexOf("export async function executeStatementAtomic");
  return source.slice(start, end);
}

test("remark PATCH semantics preserve, clear, and detect changes", () => {
  assert.deepEqual(resolveRemarkUpdate("note", undefined), { next: "note", changed: false });
  assert.deepEqual(resolveRemarkUpdate(null, undefined), { next: null, changed: false });
  assert.deepEqual(resolveRemarkUpdate("note", ""), { next: null, changed: true });
  assert.deepEqual(resolveRemarkUpdate("note", "   "), { next: null, changed: true });
  assert.deepEqual(resolveRemarkUpdate(null, ""), { next: null, changed: false });
  assert.deepEqual(resolveRemarkUpdate(null, "  hello  "), { next: "hello", changed: true });
  assert.deepEqual(resolveRemarkUpdate("note", "note"), { next: "note", changed: false });
  assert.deepEqual(resolveRemarkUpdate("note", "other"), { next: "other", changed: true });
});

test("RAW final-event updates persist only classification and remark fields", () => {
  const block = finalEventBlock();
  const updateStart = block.indexOf("const updated = await tx.bankTransaction.update");
  const updateEnd = block.indexOf("include:", updateStart);
  const dataBlock = block.slice(updateStart, updateEnd);
  assert.match(dataBlock, /eventCodeId: input\.eventCodeId/);
  assert.match(dataBlock, /eventCampaignId: input\.eventCampaignId \?\? null/);
  assert.match(dataBlock, /remark: remarkUpdate\.next/);
  assert.doesNotMatch(dataBlock, /originalAmount|transactionDate|transactionType|referenceNo|senderName|description|suffixCode|suggestedEventCodeId|baseAmount/);
});

test("remark history is written only when the remark actually changes", () => {
  const block = finalEventBlock();
  assert.match(block, /resolveRemarkUpdate\(current\.remark, input\.remark\)/);
  assert.match(block, /&& !remarkUpdate\.changed\) return current/);
  assert.match(block, /if \(remarkUpdate\.changed\) await tx\.bankTransactionHistory\.create/);
  assert.match(block, /fieldName: "remark"/);
  assert.match(block, /oldValue: current\.remark \?\? null/);
  assert.match(block, /newValue: remarkUpdate\.next/);
});

test("Execute rejects a statement with zero transactions", () => {
  const source = repository();
  const start = source.indexOf("export async function executeStatementAtomic");
  const block = source.slice(start);
  assert.match(block, /statement\.transactions\.length === 0/);
  assert.match(block, /has no transactions to submit for approval/);
});
