import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canonicalDuplicateSignature,
  matchDuplicateTransactions
} from "../src/modules/reconciliation/statement-upload/statement-upload.duplicate.js";

type Evidence = {
  id: string;
  statementUploadId: string;
  transactionDate: Date;
  transactionType: string;
  referenceNo: string | null;
  senderName: string | null;
  description: string | null;
  originalAmount: string;
};
type Incoming = Evidence & { sourceTransactionNo: number; sourceWorksheetRow: number | null; sourceSheetName: string | null };

function bankRow(id: string, overrides: Partial<Evidence> = {}): Evidence {
  return {
    id,
    statementUploadId: `stmt-${id}`,
    transactionDate: new Date("2026-09-01T00:00:00.000Z"),
    transactionType: "TRSF E-BANKING CR",
    referenceNo: "REF-SAME",
    senderName: "BUDI",
    description: "TRANSFER MASUK",
    originalAmount: "100000.00",
    ...overrides
  };
}
function evidence(id: string, overrides: Partial<Evidence> = {}): Evidence {
  return bankRow(id, overrides);
}
function incoming(id: string, overrides: Partial<Incoming> = {}): Incoming {
  return {
    ...bankRow(id),
    sourceTransactionNo: Number(id.replace(/\D/g, "")) || 1,
    sourceWorksheetRow: null,
    sourceSheetName: "Sheet1",
    ...overrides
  };
}

test("multiset matching preserves multiplicity", () => {
  const oneToTwo = matchDuplicateTransactions([incoming("i1"), incoming("i2")], [evidence("e1")]);
  assert.equal(oneToTwo.duplicates.length, 1);
  assert.equal(oneToTwo.newRows.length, 1);

  const twoToTwo = matchDuplicateTransactions([incoming("i1"), incoming("i2")], [evidence("e1"), evidence("e2")]);
  assert.equal(twoToTwo.duplicates.length, 2);
  assert.equal(twoToTwo.newRows.length, 0);

  const twoToThree = matchDuplicateTransactions(
    [incoming("i1"), incoming("i2"), incoming("i3")],
    [evidence("e1"), evidence("e2")]
  );
  assert.equal(twoToThree.duplicates.length, 2);
  assert.equal(twoToThree.newRows.length, 1);
  assert.equal(twoToThree.newRows[0].id, "i3");
});

test("multiset matching is order independent and keeps unmatched order", () => {
  const existing = [evidence("e1"), evidence("e2", { originalAmount: "200000.00" }), evidence("e3")];
  const ordered = matchDuplicateTransactions(
    [incoming("i1"), incoming("i2"), incoming("i3", { originalAmount: "200000.00" })],
    existing
  );
  const shuffled = matchDuplicateTransactions(
    [incoming("i1"), incoming("i2"), incoming("i3", { originalAmount: "200000.00" })],
    [...existing].reverse()
  );
  assert.equal(ordered.duplicates.length, 3);
  assert.equal(ordered.newRows.length, 0);
  assert.equal(shuffled.duplicates.length, 3);
  assert.equal(shuffled.newRows.length, 0);

  const mixed = matchDuplicateTransactions(
    [incoming("i1", { referenceNo: "REF-NEW" }), incoming("i2")],
    [evidence("e1")]
  );
  assert.equal(mixed.newRows.length, 1);
  assert.equal(mixed.newRows[0].id, "i1");
  assert.equal(mixed.duplicates.length, 1);
  assert.equal(mixed.duplicates[0].incoming.id, "i2");
});

test("duplicate signature uses immutable bank evidence only", () => {
  const signature = canonicalDuplicateSignature(bankRow("e1"));
  assert.match(signature, /^[0-9a-f]{64}$/);
  assert.equal(canonicalDuplicateSignature(bankRow("e2")), signature);

  const withDerivedClassification = {
    ...bankRow("e3"),
    rowNo: 99,
    suffixCode: "000",
    suggestedEventCodeId: "suggested",
    eventCodeId: "event",
    eventCampaignId: "campaign",
    remark: "operator note",
    baseAmount: "1.00"
  } as unknown as Parameters<typeof canonicalDuplicateSignature>[0];
  assert.equal(canonicalDuplicateSignature(withDerivedClassification), signature);

  assert.notEqual(canonicalDuplicateSignature(bankRow("e4", { originalAmount: "100001.00" })), signature);
  assert.notEqual(canonicalDuplicateSignature(bankRow("e4", { originalAmount: "-100000.00" })), signature);
  assert.notEqual(canonicalDuplicateSignature(bankRow("e5", { transactionDate: new Date("2026-09-02T00:00:00.000Z") })), signature);
  assert.notEqual(canonicalDuplicateSignature(bankRow("e6", { referenceNo: "REF-OTHER" })), signature);
  assert.notEqual(canonicalDuplicateSignature(bankRow("e7", { description: "OTHER" })), signature);
  assert.notEqual(canonicalDuplicateSignature(bankRow("e8", { transactionType: "BYR VIA E-BANKING" })), signature);
  assert.notEqual(canonicalDuplicateSignature(bankRow("e9", { senderName: "SITI" })), signature);
});

test("duplicates record the actual matched transaction and statement", () => {
  const result = matchDuplicateTransactions([incoming("i1"), incoming("i2")], [evidence("e1"), evidence("e2")]);
  assert.deepEqual(
    result.duplicates.map(({ matched }) => [matched.id, matched.statementUploadId]),
    [["e1", "stmt-e1"], ["e2", "stmt-e2"]]
  );
});

test("upload persists attempt, manifest, and conditional statement inside the locked transaction", () => {
  const repository = readFileSync(new URL("../src/modules/reconciliation/statement-upload/statement-upload.repository.ts", import.meta.url), "utf8");
  const persistStart = repository.indexOf("export async function persistParsedStatement");
  const finalEventStart = repository.indexOf("export async function updateTransactionFinalEventAtomic");
  const block = repository.slice(persistStart, finalEventStart);

  const lockIndex = block.indexOf("FOR UPDATE");
  const evidenceIndex = block.indexOf("bankTransaction.findMany");
  assert.ok(lockIndex >= 0, "bank account row lock is present");
  assert.ok(evidenceIndex > lockIndex, "row lock precedes duplicate-scope read");
  assert.match(block, /status: \{ not: "WITHDRAWN" \}/);
  assert.match(block, /sourceType: "BANK"/);
  assert.match(block, /bankStatementUploadAttempt\.create/);
  assert.match(block, /bankStatementUploadDuplicate\.createMany/);
  assert.match(block, /statementUploadId: createdStatement\.id/);
  assert.match(block, /P2034/);
  assert.match(block, /"P2010"/);
  assert.match(block, /"1213", "1205"/);

  const attemptCreate = block.indexOf("bankStatementUploadAttempt.create");
  const guardIndex = block.indexOf("if (newRows.length > 0)");
  const statementCreate = block.indexOf("bankStatementUpload.create", guardIndex);
  const createTransactions = block.indexOf("bankTransaction.createMany");
  const lockUpdate = block.indexOf("openingBalanceLockedAt: new Date()", createTransactions);
  assert.ok(attemptCreate > -1 && guardIndex > attemptCreate, "attempt is always created before the new-row guard");
  assert.ok(statementCreate > guardIndex, "statement is created only when new rows exist");
  assert.ok(createTransactions > guardIndex && lockUpdate > createTransactions, "lock update follows imported inserts");
});

test("upload response reports source, imported, and duplicate counts", () => {
  const controller = readFileSync(new URL("../src/modules/reconciliation/statement-upload/statement-upload.controller.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/modules/reconciliation/statement-upload/statement-upload.service.ts", import.meta.url), "utf8");
  assert.match(controller, /res\.status\(result\.uploadResult\.importedTransactions > 0 \? 201 : 200\)/);
  assert.match(service, /sourceTransactions: result\.sourceTransactionCount/);
  assert.match(service, /importedTransactions: result\.importedTransactionCount/);
  assert.match(service, /duplicateTransactions: result\.duplicateTransactionCount/);
  assert.match(service, /result\.statementId\s*\?[\s\S]*getStatementUploadWorkspace\(result\.statementId\)[\s\S]*getStatementUploadWorkspace\(\)/);
});

type NullDated<T> = Omit<T, "transactionDate"> & { transactionDate: null };
function nullDatedEvidence(id: string, overrides: Partial<Omit<Evidence, "transactionDate">> = {}): NullDated<Evidence> {
  return { ...bankRow(id), ...overrides, transactionDate: null };
}
function nullDatedIncoming(id: string, overrides: Partial<Omit<Incoming, "transactionDate">> = {}): NullDated<Incoming> {
  return { ...incoming(id), ...overrides, transactionDate: null };
}

test("upload path cannot persist a BANK row without a transaction date", () => {
  const repository = readFileSync(new URL("../src/modules/reconciliation/statement-upload/statement-upload.repository.ts", import.meta.url), "utf8");
  const inputStart = repository.indexOf("export type PersistParsedStatementInput");
  const inputEnd = repository.indexOf("export type PersistParsedStatementResult");
  const inputBlock = repository.slice(inputStart, inputEnd);
  assert.match(inputBlock, /transactionDate: Date;/);
  assert.doesNotMatch(inputBlock, /transactionDate: Date\s*\|\s*null/);

  const parser = readFileSync(new URL("../src/modules/reconciliation/statement-upload/statement-upload.parser.ts", import.meta.url), "utf8");
  assert.match(parser, /transactionDate: Date;/);
  assert.match(parser, /if \(date && amount\) return \{ transactionType, date, amount \};/);
  assert.match(parser, /if \(!date \|\| !direction\) return null;/);

  const persistStart = repository.indexOf("export async function persistParsedStatement");
  const persistEnd = repository.indexOf("export async function updateTransactionFinalEventAtomic");
  const persistBlock = repository.slice(persistStart, persistEnd);
  assert.match(persistBlock, /transaction\.transactionDate\.getTime\(\)/);
});

test("multiset matcher is null-date safe for canonical signatures", () => {
  const caseA = matchDuplicateTransactions([nullDatedIncoming("i1")], [nullDatedEvidence("e1")]);
  assert.equal(caseA.duplicates.length, 1);
  assert.equal(caseA.newRows.length, 0);
  assert.equal(caseA.duplicates[0].matched.id, "e1");

  const caseB = matchDuplicateTransactions(
    [incoming("i1"), nullDatedIncoming("i2")],
    [evidence("e1"), nullDatedEvidence("e2")]
  );
  assert.deepEqual(caseB.duplicates.map(({ matched }) => matched.id), ["e1", "e2"]);
  assert.equal(caseB.newRows.length, 0);

  const caseC = matchDuplicateTransactions([nullDatedIncoming("i1"), nullDatedIncoming("i2")], []);
  assert.equal(caseC.duplicates.length, 0);
  assert.equal(caseC.newRows.length, 2);
});
