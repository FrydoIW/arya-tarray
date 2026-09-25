import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { campaignDisplayStatus } from "../src/modules/campaign/campaign-financial-summary.domain.js";
import { summarizeTimeBasedCarry } from "../src/modules/monitoring/time-based/time-based-monitoring.repository.js";

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
  assert.match(repository, /map\(\(\{ carryCents, \.\.\.row \}\)/);
  assert.match(repository, /outstandingCarry: centsToDecimal\(carryCents\)/);
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
