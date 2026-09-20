import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { timeBasedPaymentPreview } from "../src/modules/member/time-based/time-based-preview.js";
import { assertCampaignParentActive, assertCampaignPeriodContainsTransactions } from "../src/modules/configuration/event-code/event-campaign.rules.js";
import { listCampaignRecords } from "../src/modules/configuration/event-code/event-campaign.repository.js";
import { assertEventTypeTransition } from "../src/modules/configuration/event-code/event-code.service.js";
import { assertSubscriptionCanDeactivate } from "../src/modules/member/data/member-data.service.js";
import { loadMemberCarryFilter } from "../src/modules/member/data/member-data.repository.js";
import { getDraftRowStatus } from "../../frontend/src/features/reconciliation/statement-upload/utils/statement-upload.utils.ts";
import { compatibleHistoricalTimePreview, paymentOnlyTimePreview } from "../../frontend/src/lib/time-based-preview.ts";
import { eventCodeActionState, normalizeInput, sameInput } from "../../frontend/src/features/configuration/event-code/utils/event-code-actions.ts";

const d = (value: string) => new Prisma.Decimal(value);
const day = (value: string) => new Date(`${value}T00:00:00Z`);
function historicalPayment(status = "ACTIVE", principal = "200000", units = 4) {
  return { eventCodeId: "time", originalAmount: d(principal), baseAmount: d(principal),
    eventCode: { eventType: "TIME_BASED", timeRule: { unitAmount: d("60000"), durationMonths: 1, activeFlag: true } },
    memberEventBalanceLedger: [{ entryType: "PAYMENT", entryStatus: status, subscriptionId: "sub", amountDelta: d(principal), unitAmountSnapshot: d("50000"), durationMonthsSnapshot: 1, subscription: { eventCodeId: "time" } }],
    memberEventCoverages: units ? [{ coverageStatus: status, subscriptionId: "sub", unitAmountSnapshot: d("50000"), durationMonthsSnapshot: 1, grantedUnits: units, amountApplied: d(String(units * 50000)), subscription: { eventCodeId: "time" } }] : [] };
}

for (const status of ["ACTIVE", "VOIDED"]) test(`Sign Approval preview preserves ${status} persisted rate and entitlement`, () => {
  const preview = timeBasedPaymentPreview(historicalPayment(status))!;
  assert.equal(preview.unitAmount, "50000");
  assert.equal(preview.grantedMonths, 4);
  assert.equal(preview.historical, true);
});

test("historical preview includes actual carry-funded grants and zero-unit allocation", () => {
  assert.equal(timeBasedPaymentPreview(historicalPayment("ACTIVE", "25000", 1))?.grantedMonths, 1);
  const zero = timeBasedPaymentPreview(historicalPayment("ACTIVE", "25000", 0))!;
  assert.equal(zero.grantedUnits, 0);
  assert.equal(zero.allocated, true);
  assert.equal(zero.paymentCredited, "25000");
});

test("preview recalculates using current entitlement after event/principal change or explicit recalc", () => {
  const original = historicalPayment();
  for (const preview of [timeBasedPaymentPreview(original, true), timeBasedPaymentPreview({ ...original, eventCodeId: "new" }),
    timeBasedPaymentPreview({ ...original, baseAmount: d("240000") })]) {
    assert.equal(preview?.unitAmount, "60000");
    assert.equal(preview?.historical, false);
  }
  assert.equal(timeBasedPaymentPreview({ ...original, baseAmount: d("240000") })?.grantedMonths, 4);
});

test("legacy coverage-only history remains readable without an active current rule", () => {
  const original = historicalPayment("VOIDED"); original.memberEventBalanceLedger = [];
  original.eventCode.timeRule.activeFlag = false;
  assert.equal(timeBasedPaymentPreview(original)?.grantedMonths, 4);
});

test("Edit Income accepts compatible historical display and rejects changed event or principal", () => {
  const preview = timeBasedPaymentPreview(historicalPayment())!;
  assert.equal(compatibleHistoricalTimePreview(preview, "time", "200000.00"), preview);
  assert.equal(compatibleHistoricalTimePreview(preview, "new", "200000"), null);
  assert.equal(compatibleHistoricalTimePreview(preview, "time", "250000"), null);
});

test("Campaign period cannot exclude any linked transaction on either side", () => {
  const linked = { earliest: day("2026-10-15"), latest: day("2026-10-25"), missingDates: 0 };
  assert.throws(() => assertCampaignPeriodContainsTransactions({ startDate: "2026-10-20", endDate: "2026-10-31" }, linked), /linked transaction/);
  assert.throws(() => assertCampaignPeriodContainsTransactions({ startDate: null, endDate: "2026-10-24" }, linked), /linked transaction/);
});

test("Campaign widening and inclusive bounds preserve linked historical transactions", () => {
  const linked = { earliest: day("2026-10-15"), latest: day("2026-10-25"), missingDates: 0 };
  assert.doesNotThrow(() => assertCampaignPeriodContainsTransactions({ startDate: "2026-10-15", endDate: "2026-10-25" }, linked));
  assert.doesNotThrow(() => assertCampaignPeriodContainsTransactions({ startDate: null, endDate: null }, linked));
});

test("Campaign reactivation requires active parent while inactive historical metadata stays editable", () => {
  assert.throws(() => assertCampaignParentActive(false, true), /parent Event Code/);
  assert.doesNotThrow(() => assertCampaignParentActive(true, true));
  assert.doesNotThrow(() => assertCampaignParentActive(false, false));
});

test("Dashboard Campaign query excludes inactive parent; Inquiry still includes history", async () => {
  const rows = [{ id: "active", activeFlag: true, eventCode: { activeFlag: true } },
    { id: "inactive-parent", activeFlag: true, eventCode: { activeFlag: false } }];
  const client = { eventCampaign: { findMany: async ({ where }: { where?: { activeFlag: boolean; eventCode: { activeFlag: boolean } } }) =>
    rows.filter(row => !where || (row.activeFlag === where.activeFlag && row.eventCode.activeFlag === where.eventCode.activeFlag)) },
    bankTransaction: { groupBy: async () => [] } };
  assert.deepEqual((await listCampaignRecords({ activeRelevantFrom: day("2026-09-16") }, client as never)).campaigns.map(row => row.id), ["active"]);
  assert.equal((await listCampaignRecords({}, client as never)).campaigns.length, 2);
});

test("TimeRule alone prevents changing TIME_BASED to STANDARD or CAMPAIGN", () => {
  for (const nextType of ["STANDARD", "CAMPAIGN"]) assert.throws(() => assertEventTypeTransition({ currentType: "TIME_BASED", nextType, transactionCount: 0, subscriptionCount: 0, hasTimeRule: true }), /Time Rule/);
  assert.doesNotThrow(() => assertEventTypeTransition({ currentType: "TIME_BASED", nextType: "TIME_BASED", transactionCount: 0, subscriptionCount: 0, hasTimeRule: true }));
});

test("subscription deactivation blocks positive and negative carry, permits zero", () => {
  assert.throws(() => assertSubscriptionCanDeactivate("25000.00"), /carry/);
  assert.throws(() => assertSubscriptionCanDeactivate("-0.01"), /carry/);
  assert.doesNotThrow(() => assertSubscriptionCanDeactivate("0.00"));
});

test("Statement readiness requires usable active Time Rule, preserves outgoing and STANDARD", () => {
  const transaction = { requiresClassification: true, eventCodeId: "event", suggestedEventCodeId: "event", baseAmount: "25000" } as Parameters<typeof getDraftRowStatus>[0];
  const event = { id: "event", code: "091", eventName: "Program", eventType: "TIME_BASED" as const };
  for (const timeRule of [null, { unitAmount: "50000", durationMonths: 1, activeFlag: false },
    { unitAmount: "0", durationMonths: 1, activeFlag: true }, { unitAmount: "50000", durationMonths: 0, activeFlag: true }])
    assert.equal(getDraftRowStatus(transaction, [{ ...event, timeRule }]), "NEEDS_REVIEW");
  assert.equal(getDraftRowStatus(transaction, [{ ...event, timeRule: { unitAmount: "50000", durationMonths: 1, activeFlag: true } }]), "MATCHED");
  assert.equal(getDraftRowStatus({ ...transaction, suggestedEventCodeId: null }, [{ ...event, eventType: "STANDARD" }]), "READY");
  assert.equal(getDraftRowStatus({ ...transaction, requiresClassification: false }, [event]), "NOT_APPLICABLE");
});

test("three-month rule preview accepts partial payments without integer conversion failure", () => {
  assert.deepEqual(paymentOnlyTimePreview("225000", "50000", 3), { months: 12, remainder: "25000.00" });
});

test("Member carry filter uses positive ACTIVE sums per subscription, including members with offsetting subscriptions", async () => {
  const ledger = [
    { sub: "a", amount: 50000, status: "ACTIVE" }, { sub: "a", amount: -25000, status: "ACTIVE" },
    { sub: "b", amount: 50000, status: "ACTIVE" }, { sub: "b", amount: -50000, status: "ACTIVE" },
    { sub: "c", amount: 50000, status: "VOIDED" }, { sub: "d", amount: -25000, status: "ACTIVE" }];
  let calls = 0;
  const client = { memberEventBalanceLedger: { groupBy: async ({ where, having }: { where: { entryStatus: string; subscription: { eventCode: { eventType: string } } }; having: { amountDelta: { _sum: { gt: number } } } }) => {
    calls++; assert.equal(where.subscription.eventCode.eventType, "TIME_BASED");
    const sums = new Map<string, number>();
    for (const row of ledger.filter(row => row.status === where.entryStatus)) sums.set(row.sub, (sums.get(row.sub) ?? 0) + row.amount);
    return [...sums].filter(([, sum]) => sum > having.amountDelta._sum.gt).map(([subscriptionId]) => ({ subscriptionId }));
  } } };
  const members = [{ id: "one", subs: ["a", "d"] }, { id: "two", subs: ["b"] }, { id: "three", subs: ["c"] }, { id: "four", subs: [] }];
  for (const [filter, expected] of [["HAS_CARRY", ["one"]], ["NO_CARRY", ["two", "three", "four"]]] as const) {
    const where = await loadMemberCarryFilter(client as never, filter);
    const relation = where.eventSubscriptions! as { some?: { id: { in: string[] } }; none?: { id: { in: string[] } } };
    const ids = (relation.some ?? relation.none)!.id.in;
    assert.deepEqual(members.filter(member => relation.some ? member.subs.some(sub => ids.includes(sub)) : !member.subs.some(sub => ids.includes(sub))).map(member => member.id), expected);
  }
  assert.deepEqual(await loadMemberCarryFilter(client as never, "ALL"), {});
  assert.equal(calls, 2);
});

test("Event Code action state blocks empty/invalid execution and reload while dirty", () => {
  const row = { id: "e", code: "001", eventName: "General", category: null, description: null, eventType: "STANDARD" as const, activeFlag: true };
  assert.deepEqual(eventCodeActionState(false, [row], false), { canClear: false, canExecute: false, canReload: true, validationError: "" });
  assert.equal(eventCodeActionState(true, [row], false).canExecute, true);
  assert.equal(eventCodeActionState(true, [row], false).canReload, false);
  assert.equal(eventCodeActionState(true, [{ ...row, code: "" }], false).canExecute, false);
  assert.equal(eventCodeActionState(true, [row, row], false).canExecute, false);
  assert.equal(eventCodeActionState(true, [row], true).canClear, false);
  assert.equal(sameInput(normalizeInput(row), normalizeInput({ ...row, eventName: " General " })), true);
});

test("bounded balance history is explicitly labeled with its repository limit", () => {
  const repository = readFileSync(new URL("../src/modules/member/data/member-data.repository.ts", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../../frontend/src/features/member/data/components/TimeBasedProgramCard.tsx", import.meta.url), "utf8");
  assert.match(repository, /balanceLedger:.*take: 24/);
  assert.ok(screen.includes("Balance history · Latest 24 entries"));
});
