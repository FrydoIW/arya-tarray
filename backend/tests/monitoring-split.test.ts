import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { campaignDisplayStatus } from "../src/modules/campaign/campaign-financial-summary.domain.js";
import { summarizeTimeBasedCarry } from "../src/modules/monitoring/time-based/time-based-monitoring.repository.js";
import { coverageState, extendTimelineWindow, isTimelineSegmentVisible, timelineWindow } from "../src/modules/monitoring/time-based/time-based-monitoring.domain.js";
import { monthLabels, timelineSegmentGeometry, todayMarkerPosition } from "../../frontend/src/features/monitoring/components/time-based-timeline.utils.js";

const decimal = (value: string) => ({ toString: () => value });

test("Campaign monitoring status is calendar-driven and does not reinterpret financial evidence", () => {
  const current = "2026-09-26";
  assert.equal(campaignDisplayStatus({ activeFlag: true, startDate: new Date("2026-10-01"), endDate: null }, current), "SCHEDULED");
  assert.equal(campaignDisplayStatus({ activeFlag: true, startDate: null, endDate: new Date("2026-09-25") }, current), "ENDED");
  assert.equal(campaignDisplayStatus({ activeFlag: true, startDate: null, endDate: null }, current), "ACTIVE");
  assert.equal(campaignDisplayStatus({ activeFlag: false, startDate: null, endDate: null }, current), "CLOSED");
});

test("Time Based monitoring reports only positive active ledger carry", () => {
  assert.deepEqual(summarizeTimeBasedCarry([
    { _sum: { amountDelta: decimal("200027") } },
    { _sum: { amountDelta: decimal("0") } },
    { _sum: { amountDelta: decimal("-50003") } }
  ]), { outstandingCarry: "200027.00", carrySourceCount: 1 });
});

test("Time Based monitoring never serializes its internal bigint carry accumulator", () => {
  const repository = readFileSync(new URL("../src/modules/monitoring/time-based/time-based-monitoring.repository.ts", import.meta.url), "utf8");
  assert.doesNotMatch(repository, /carryCents/);
  assert.match(repository, /coverageSegments/);
  assert.doesNotThrow(() => JSON.stringify({
    summary: { outstandingCarry: "200027.00", carrySourceCount: 9 },
    timeline: { rows: [{ coverageStatus: "COVERED", carryBalance: "5.00", coverageSegments: [{ coverageId: "coverage", coverageFrom: "2026-09-01", coverageTo: "2026-09-30", source: "TRANSFER" }] }] }
  }));
});

test("Coverage timeline preserves actual coverage evidence states", () => {
  const today = new Date("2026-09-26T00:00:00.000Z"); const expiring = new Date("2026-10-26T00:00:00.000Z");
  assert.deepEqual(coverageState([{ coverageStatus: "ACTIVE", coverageFrom: new Date("2026-09-01"), coverageTo: new Date("2026-09-30") }], today, expiring),
    { currentlyCovered: true, expiring: true, expired: false, noCoverage: false });
  assert.deepEqual(coverageState([{ coverageStatus: "ACTIVE", coverageFrom: new Date("2026-08-01"), coverageTo: new Date("2026-08-31") }], today, expiring),
    { currentlyCovered: false, expiring: false, expired: true, noCoverage: false });
  assert.deepEqual(coverageState([{ coverageStatus: "ACTIVE", coverageFrom: new Date("2026-10-01"), coverageTo: new Date("2026-10-31") }], today, expiring),
    { currentlyCovered: false, expiring: false, expired: false, noCoverage: false });
  assert.deepEqual(coverageState([], today, expiring), { currentlyCovered: false, expiring: false, expired: false, noCoverage: true });
});

test("Timeline geometry uses a six-month window, clips segments, and hides Today outside it", () => {
  const window = timelineWindow(new Date("2026-09-26T00:00:00.000Z"));
  const displayWindow = { start: "2026-09-01", end: "2027-02-28", monthCount: 6 };
  assert.deepEqual({ start: window.start.toISOString().slice(0, 10), end: window.end.toISOString().slice(0, 10), monthCount: window.monthCount }, displayWindow);
  assert.equal(monthLabels(displayWindow).length, 6);
  const geometry = timelineSegmentGeometry({ coverageFrom: "2026-08-15", coverageTo: "2026-03-15" }, displayWindow);
  assert.equal(geometry, null);
  const clipped = timelineSegmentGeometry({ coverageFrom: "2026-08-15", coverageTo: "2026-10-15" }, displayWindow);
  assert.equal(clipped?.left, 0);
  assert.ok((clipped?.width ?? 0) > 20);
  assert.ok(Math.abs((todayMarkerPosition("2026-09-26", displayWindow) ?? 0) - (25 / 181 * 100)) < 0.001);
  assert.equal(todayMarkerPosition("2027-03-01", displayWindow), null);
  const extended = extendTimelineWindow(window, new Date("2027-07-15T00:00:00.000Z"));
  assert.deepEqual({ start: extended.start.toISOString().slice(0, 10), end: extended.end.toISOString().slice(0, 10), monthCount: extended.monthCount }, { start: "2026-09-01", end: "2027-08-31", monthCount: 12 });
  assert.equal(isTimelineSegmentVisible({ coverageFrom: new Date("2026-08-15"), coverageTo: new Date("2026-10-15") }, window), true);
});

test("Time Based timeline keeps Today below month labels and Carry outside the chart", () => {
  const component = readFileSync(new URL("../../frontend/src/features/monitoring/components/TimeBasedCoverageTimeline.tsx", import.meta.url), "utf8");
  assert.ok(component.indexOf("styles.monthHeader") < component.indexOf("timelineStyles.todayRuler"));
  assert.ok(component.indexOf("timelineStyles.todayRuler") < component.indexOf("timelineStyles.timelineBody"));
  assert.match(component, /summaryHeader[\s\S]*?<span>Donor<\/span><span>Program \/ Event<\/span><span>Carry<\/span><span>Status<\/span>/);
  assert.doesNotMatch(component, /With Carry|Has Carry|Ada Carry|visible segment|Segments in View/i);
});

test("Dashboard has no Campaign or Time Based read-model dependency", () => {
  const service = readFileSync(new URL("../src/modules/monitoring/dashboard/dashboard.service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(service, /getCampaignSummaries|loadDashboardTimeBased/);
  const campaignSummary = readFileSync(new URL("../src/modules/campaign/campaign-financial-summary.repository.ts", import.meta.url), "utf8");
  assert.match(campaignSummary, /directContribution/);
  assert.match(campaignSummary, /carryAllocation/);
  assert.match(campaignSummary, /targetApplied/);
  assert.match(campaignSummary, /campaignCarry/);
});
