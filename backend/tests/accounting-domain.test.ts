import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  ACCOUNTING_ACCOUNTS, accountingCents, accountingTotalCents, accountingDateValue, accountingState, assertBalanced,
  parseAccountingCutover, recognitionEligible, recognitionLines, reclassificationLines,
  type AccountingDimension, type AccountingSource
} from "../src/modules/accounting/accounting.domain.js";

const cutover = parseAccountingCutover("2026-11-01");
const source: AccountingSource = {
  id: "transaction", status: "FINALIZED", sourceType: "BANK", transactionDate: cutover,
  originalAmount: "1000000.123", eventCodeId: "event-a", eventCampaignId: null,
  eventType: "STANDARD", reconciliationExcludedAt: null
};
const dimension: AccountingDimension = {
  bankAccountId: "bank", bankNameSnapshot: "Synthetic Bank", bankAccountNoSnapshot: "SYNTHETIC-001",
  bankAccountNameSnapshot: "Synthetic Account", eventCodeId: "event-a", eventCodeSnapshot: "001",
  eventNameSnapshot: "Event A", eventTypeSnapshot: "STANDARD", eventCampaignId: null,
  campaignNameSnapshot: null, memberIdentityId: "identity", donorNameSnapshot: "Synthetic Donor",
  memberId: "member", memberCodeSnapshot: "SYN-001", memberNameSnapshot: "Synthetic Member"
};
const validSource = { ...source, originalAmount: "1000123.01" };

for (const eventType of ["STANDARD", "CAMPAIGN", "TIME_BASED"]) {
  test(`${eventType} recognizes originalAmount using the same exact Bank/Revenue lines`, () => {
    const lines = recognitionLines({ ...validSource, eventType }, { ...dimension, eventTypeSnapshot: eventType }, cutover);
    assert.equal(lines.length, 2);
    assert.equal(lines[0]!.accountCode, "1110");
    assert.equal(lines[0]!.debit, "1000123.01");
    assert.equal(lines[1]!.accountCode, "4110");
    assert.equal(lines[1]!.credit, "1000123.01");
    assertBalanced(lines);
  });
}

test("cutover requires an explicit calendar first day and has no fallback", () => {
  for (const value of [undefined, "", "2026-11-02", "2026-13-01", "2026-02-30", "2026-1-01", " 2026-11-01"]) {
    assert.throws(() => parseAccountingCutover(value));
  }
  assert.equal(accountingDateValue(cutover), "2026-11-01");
});

test("eligibility depends on transaction date, never finalization time", () => {
  assert.equal(recognitionEligible({ ...validSource, transactionDate: new Date("2026-10-31T00:00:00Z") }, cutover), false);
  assert.equal(recognitionEligible(validSource, cutover), true);
  assert.equal(recognitionEligible({ ...validSource, transactionDate: new Date("2026-11-02T00:00:00Z") }, cutover), true);
  assert.equal(recognitionEligible({ ...validSource, transactionDate: null }, cutover), false);
});

for (const status of ["RAW", "CHECK"]) {
  test(`${status} source cannot create official recognition`, () => {
    assert.deepEqual(recognitionLines({ ...validSource, status }, dimension, cutover), []);
  });
}

test("manual incoming and outgoing are review-required and never construct GL", () => {
  for (const originalAmount of ["100.00", "-100.00"]) {
    const manual = { ...validSource, sourceType: "MANUAL", originalAmount };
    assert.deepEqual(recognitionLines(manual, dimension, cutover), []);
    assert.equal(accountingState(manual, false, cutover), "ACCOUNTING_REVIEW_REQUIRED");
  }
});

test("excluded posted receipt preserves accounting and requires review", () => {
  const excluded = { ...validSource, reconciliationExcludedAt: new Date() };
  assert.deepEqual(recognitionLines(excluded, dimension, cutover), []);
  assert.equal(accountingState(excluded, true, cutover), "ACCOUNTING_REVIEW_REQUIRED");
  assert.equal(accountingState(excluded, false, cutover), "NOT_APPLICABLE");
});

test("read states distinguish cutover, pending, unaccounted finalization, and posted evidence", () => {
  assert.equal(accountingState({ ...validSource, transactionDate: new Date("2026-10-31") }, false, cutover), "PRE_CUTOVER_NON_ACCOUNTED");
  assert.equal(accountingState({ ...validSource, status: "CHECK" }, false, cutover), "PREVIEW_NOT_POSTED");
  assert.equal(accountingState(validSource, false, cutover), "ACCOUNTING_REVIEW_REQUIRED");
  assert.equal(accountingState(validSource, true, cutover), "POSTED");
  assert.equal(accountingState({ ...validSource, originalAmount: "-1.00" }, false, cutover), "NOT_APPLICABLE");
});

test("strict money validation rejects truncation, exponent notation, overflow and malformed decimals", () => {
  for (const value of ["1.001", "1e3", "NaN", "-", "1.2.3", "1000000000000000000.00", " 1.00"]) {
    assert.throws(() => accountingCents(value));
  }
  assert.equal(accountingCents("999999999999999999.99"), 99999999999999999999n);
  assert.throws(() => recognitionLines(source, dimension, cutover));
});

test("balance validation rejects zero, negative, both sides positive and unequal totals", () => {
  for (const lines of [[], [{ debit: "0.00", credit: "0.00" }, { debit: "0.00", credit: "0.00" }],
    [{ debit: "-1.00", credit: "0.00" }, { debit: "0.00", credit: "1.00" }],
    [{ debit: "1.00", credit: "1.00" }, { debit: "0.00", credit: "1.00" }],
    [{ debit: "0.01", credit: "0.00" }, { debit: "0.00", credit: "0.02" }]]) {
    assert.throws(() => assertBalanced(lines));
  }
  assertBalanced([{ debit: "999999999999999999.99", credit: "0.00" }, { debit: "0.00", credit: "999999999999999999.99" }]);
});

test("event and campaign reclassification changes dimensions without Bank or net revenue", () => {
  for (const next of [{ ...dimension, eventCodeId: "event-b", eventCodeSnapshot: "002" },
    { ...dimension, eventCampaignId: "campaign-b", campaignNameSnapshot: "Campaign B" }]) {
    const original = structuredClone(dimension);
    const lines = reclassificationLines("1000123.01", dimension, next);
    assertBalanced(lines);
    assert.ok(lines.every(line => line.accountCode === "4110"));
    assert.equal(accountingCents(lines[0]!.debit) - accountingCents(lines[1]!.credit), 0n);
    assert.deepEqual(dimension, original);
  }
});

test("remark and Member-only differences do not construct reclassification", () => {
  assert.deepEqual(reclassificationLines("100.00", dimension, { ...dimension, memberId: "other" }), []);
  const next = { ...dimension, eventCodeId: "event-b", memberId: "other", memberNameSnapshot: "Changed" };
  const lines = reclassificationLines("100.00", dimension, next);
  assert.equal(lines[1]!.memberId, dimension.memberId);
  assert.equal(lines[1]!.memberNameSnapshot, dimension.memberNameSnapshot);
});

test("COA stays limited to Bank and Contribution Revenue", () => {
  assert.deepEqual(ACCOUNTING_ACCOUNTS.map(account => account.code), ["1110", "4110"]);
});

test("aggregate totals remain exact above the individual posting limit", () => {
  assert.equal(accountingTotalCents("1999999999999999999.98"), 199999999999999999998n);
  for (const value of ["1e20", "1.001", "NaN"]) assert.throws(() => accountingTotalCents(value));
});

test("reclassification cannot inherit persisted journal/line keys", () => {
  const previous = { ...dimension, id: "old-line", journalId: "old-journal", accountId: "old-account", createdAt: new Date() };
  const lines = reclassificationLines("100.00", previous, { ...dimension, eventCodeId: "event-b" });
  for (const line of lines) for (const key of ["id", "journalId", "accountId", "createdAt"]) assert.equal(key in line, false);
});

test("schema-only integration snapshot matches every Prisma table without production patch execution", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const sql = readFileSync(new URL("./integration/current-schema.mysql.sql", import.meta.url), "utf8");
  const models = [...schema.matchAll(/@@map\("(arya_[^"]+)"\)/g)].map(match => match[1]).sort();
  const tables = [...sql.matchAll(/^CREATE TABLE `([^`]+)`/gm)].map(match => match[1]);
  assert.deepEqual(tables, models);
  assert.equal(tables.length, 35);
  assert.doesNotMatch(sql, /^\s*(?:INSERT|REPLACE|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE DATABASE|USE|GRANT|CREATE USER|LOAD DATA)\b/im);
  assert.match(sql, /ck_accounting_line_sides/);
  assert.match(sql, /uk_accounting_source_event/);
});

test("local manual SQL patches are ignored", () => {
  assert.match(execFileSync("git", ["check-ignore", ".local/sql-patches/accounting-phase1-v1.mysql.sql"],
    { cwd: new URL("../../", import.meta.url), encoding: "utf8" }), /accounting-phase1-v1/);
});
