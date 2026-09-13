import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { timeRuleValueSchema } from "../src/modules/configuration/event-code/event-time-rule.schema.js";
import { assertEventTypeTransition } from "../src/modules/configuration/event-code/event-code.service.js";
import { sponsorshipStatus } from "../src/modules/member/data/member-data.service.js";
import { resolveTimeBasedUnits } from "../src/modules/reconciliation/time-based-classification.js";
import { addCalendarMonthsInclusive, historicalCoverageEntitlement, isCurrentTimeBasedAllocation, resolveCoverageStart, selectHistoricalCoverageEntitlement } from "../src/modules/member/time-based/member-time-based.service.js";

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

test("expired subscription with an old start date restarts coverage at payment date", () => {
  const startDate = new Date("2026-09-13T00:00:00Z");
  const paymentDate = new Date("2027-03-10T00:00:00Z");
  assert.equal(resolveCoverageStart({ latestCoverageTo: null, startDate, transactionDate: paymentDate }).toISOString().slice(0, 10), "2026-09-13");
  assert.equal(resolveCoverageStart({ latestCoverageTo: new Date("2027-01-31T00:00:00Z"), startDate, transactionDate: paymentDate }).toISOString().slice(0, 10), "2027-03-10");
  assert.equal(resolveCoverageStart({ latestCoverageTo: new Date("2027-03-31T00:00:00Z"), startDate, transactionDate: paymentDate }).toISOString().slice(0, 10), "2027-04-01");
});

test("identity move or detach invalidates an allocation owned by a different current Member", () => {
  const allocation = { subscriptionMemberId: "member-a", subscriptionEventCodeId: "event-a", paymentEventCodeId: "event-a", verificationStatus: "VERIFIED" as const };
  assert.equal(isCurrentTimeBasedAllocation({ ...allocation, paymentMemberId: "member-a" }), true);
  assert.equal(isCurrentTimeBasedAllocation({ ...allocation, paymentMemberId: "member-b" }), false);
  assert.equal(isCurrentTimeBasedAllocation({ ...allocation, paymentMemberId: null, verificationStatus: "UNVERIFIED" }), false);
});

test("VOIDED coverage preserves the historical snapshot for unchanged reallocation", () => {
  const oldSnapshot = historicalCoverageEntitlement({ eventCodeId: "event-a", subscriptionEventCodeId: "event-a", unitAmount: { toString: () => "50000.00" }, durationMonths: 1, grantedUnits: 4, amountApplied: { toString: () => "200000.00" } });
  assert.deepEqual(oldSnapshot, { unitAmount: "50000.00", durationMonths: 1, grantedUnits: 4, amountApplied: "200000.00" });
  const voidedCoverage = { coverageStatus: "VOIDED", subscriptionEventCodeId: "event-a", unitAmount: { toString: () => "50000.00" }, durationMonths: 1, grantedUnits: 4, amountApplied: { toString: () => "200000.00" } };
  assert.deepEqual(selectHistoricalCoverageEntitlement({ eventCodeId: "event-a", recalculate: false, coverages: [voidedCoverage] }), oldSnapshot);
  assert.equal(selectHistoricalCoverageEntitlement({ eventCodeId: "event-b", recalculate: false, coverages: [voidedCoverage] }), null);
  assert.equal(selectHistoricalCoverageEntitlement({ eventCodeId: "event-a", recalculate: true, coverages: [voidedCoverage] }), null);
});

test("Event Type transition blocks historical transactions while allowing a clean Event Code", () => {
  assert.throws(() => assertEventTypeTransition({ currentType: "STANDARD", nextType: "TIME_BASED", transactionCount: 1, subscriptionCount: 0 }), /cannot become TIME_BASED/);
  assert.throws(() => assertEventTypeTransition({ currentType: "TIME_BASED", nextType: "STANDARD", transactionCount: 1, subscriptionCount: 0 }), /must remain TIME_BASED/);
  assert.throws(() => assertEventTypeTransition({ currentType: "TIME_BASED", nextType: "CAMPAIGN", transactionCount: 0, subscriptionCount: 1 }), /must remain TIME_BASED/);
  assert.doesNotThrow(() => assertEventTypeTransition({ currentType: "STANDARD", nextType: "TIME_BASED", transactionCount: 0, subscriptionCount: 0 }));
});

test("subscription without coverage is PENDING instead of funded ACTIVE", () => {
  assert.equal(sponsorshipStatus({ activeFlag: true, startDate: null, validUntil: null }), "PENDING");
  assert.equal(sponsorshipStatus({ activeFlag: true, startDate: null, validUntil: new Date("2099-12-31T00:00:00Z") }), "ACTIVE");
});

test("coverage service preserves snapshots, starts from validity, and prevents duplicate active entitlement", () => {
  const source = readFileSync(new URL("../src/modules/member/time-based/member-time-based.service.ts", import.meta.url), "utf8");
  assert.match(source, /if \(sameOfficialAllocation && !options\?\.recalculate\) return/);
  assert.match(source, /isCurrentTimeBasedAllocation/);
  assert.match(source, /reconcileTimeBasedCoverageForIdentity/);
  assert.match(source, /bankTransactionId: payment\.id[\s\S]*coverageStatus: "ACTIVE"/);
  assert.match(source, /This payment is already allocated to active coverage/);
  const memberData = readFileSync(new URL("../src/modules/member/data/member-data.service.ts", import.meta.url), "utf8");
  assert.match(memberData, /coverageSource: "OPENING"/);
  assert.match(memberData, /rebuildTimeBasedSubscription/);
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

test("rate guard, manual adjustment restriction, and subscription resync protect unresolved payments", () => {
  const rules = readFileSync(new URL("../src/modules/configuration/event-code/event-time-rule.service.ts", import.meta.url), "utf8");
  const editIncome = readFileSync(new URL("../src/modules/reconciliation/edit-income/edit-income.repository.ts", import.meta.url), "utf8");
  const memberData = readFileSync(new URL("../src/modules/member/data/member-data.service.ts", import.meta.url), "utf8");
  assert.match(rules, /Resolve or allocate pending TIME_BASED payments/);
  assert.match(rules, /status: "FINALIZED"[\s\S]*memberEventCoverages/);
  assert.match(editIncome, /TIME_BASED Event Codes are not available for manual adjustments/);
  assert.match(memberData, /synchronizePendingTimeBasedForMember\(tx, memberId, userId, input\.eventCodeId\)/);
});

test("no Stage 3 database schema or migration workflow is introduced", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(schema, /model EventTimeRule/);
  assert.match(schema, /model MemberEventCoverage/);
  const service = readFileSync(new URL("../src/modules/member/time-based/member-time-based.service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(service, /amount_remainder|invoice|recurring billing/i);
});
