import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { timeRuleValueSchema } from "../src/modules/configuration/event-code/event-time-rule.schema.js";
import { resolveTimeBasedUnits } from "../src/modules/reconciliation/time-based-classification.js";
import { addCalendarMonthsInclusive } from "../src/modules/member/time-based/member-time-based.service.js";

const event = { id: "rupang", eventType: "TIME_BASED" };
const rule = { unitAmount: { toString: () => "50000.00" }, durationMonths: 1, activeFlag: true };
const payment = (amount: string) => ({ originalAmount: { toString: () => amount }, baseAmount: { toString: () => amount } });

test("Time Rule validates positive whole-month configuration", () => {
  assert.equal(timeRuleValueSchema.safeParse({ unitAmount: "50000", durationMonths: 1, activeFlag: true, remark: null }).success, true);
  assert.equal(timeRuleValueSchema.safeParse({ unitAmount: "0", durationMonths: 1, activeFlag: true, remark: null }).success, false);
  assert.equal(timeRuleValueSchema.safeParse({ unitAmount: "50000", durationMonths: 1.5, activeFlag: true, remark: null }).success, false);
});

test("exact Time-Based units use principal amount and reject remainders", () => {
  assert.deepEqual(resolveTimeBasedUnits({ eventCode: event, rule, transaction: payment("200000.00"), requiresClassification: true }), { grantedUnits: 4, unitAmount: "50000.00", durationMonths: 1, amountApplied: "200000.00" });
  assert.throws(() => resolveTimeBasedUnits({ eventCode: event, rule, transaction: payment("75000.00"), requiresClassification: true }), /exact multiple/);
});

test("calendar coverage is inclusive and retains the day-of-month boundary", () => {
  assert.equal(addCalendarMonthsInclusive(new Date("2026-09-13T00:00:00Z"), 1).toISOString().slice(0, 10), "2026-10-12");
  assert.equal(addCalendarMonthsInclusive(new Date("2026-09-13T00:00:00Z"), 4).toISOString().slice(0, 10), "2027-01-12");
  assert.equal(addCalendarMonthsInclusive(new Date("2026-01-31T00:00:00Z"), 1).toISOString().slice(0, 10), "2026-02-27");
});

test("coverage service preserves snapshots, starts from validity, and prevents duplicate active entitlement", () => {
  const source = readFileSync(new URL("../src/modules/member/time-based/member-time-based.service.ts", import.meta.url), "utf8");
  assert.match(source, /if \(validUntil[\s\S]*>=.*transactionDate.*\) return addDays\(validUntil, 1\)/);
  assert.match(source, /if \(sameOfficialEvent && !options\?\.recalculate\) return/);
  assert.match(source, /bankTransactionId: payment\.id[\s\S]*coverageStatus: "ACTIVE"/);
  assert.match(source, /This payment is already allocated to active coverage/);
  const memberData = readFileSync(new URL("../src/modules/member/data/member-data.service.ts", import.meta.url), "utf8");
  assert.match(memberData, /coverageSource: "OPENING"/);
});

test("finalization, identity linking, correction, and dashboard summary retain their separate responsibilities", () => {
  const approval = readFileSync(new URL("../src/modules/approval/sign-approval/sign-approval.repository.ts", import.meta.url), "utf8");
  const registration = readFileSync(new URL("../src/modules/member/registration/member-registration.repository.ts", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../src/modules/monitoring/dashboard/dashboard.repository.ts", import.meta.url), "utf8");
  assert.match(approval, /input\.decision === "APPROVED"[\s\S]*synchronizeTimeBasedTransaction/);
  assert.match(approval, /changedTimeBasedTransactionIds/);
  assert.match(registration, /synchronizePendingTimeBasedForMember/);
  assert.match(dashboard, /loadDashboardTimeBasedSummary/);
  assert.match(dashboard, /validUntil: \{ gte: today, lte: expiringUntil \}/);
});

test("no Stage 3 database schema or migration workflow is introduced", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(schema, /model EventTimeRule/);
  assert.match(schema, /model MemberEventCoverage/);
  const service = readFileSync(new URL("../src/modules/member/time-based/member-time-based.service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(service, /amount_remainder|invoice|recurring billing/i);
});
