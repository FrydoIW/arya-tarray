import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertCampaignClassification } from "../src/modules/reconciliation/campaign-classification.js";
import { officialCampaignAmountWhere } from "../src/modules/configuration/event-code/event-campaign.repository.js";
import { campaignDisplayStatus } from "../src/modules/configuration/event-code/event-campaign.service.js";
import { campaignValueSchema } from "../src/modules/configuration/event-code/event-campaign.schema.js";

const event = { id: "event-a", eventType: "CAMPAIGN", activeFlag: true };
const september = { id: "campaign-september", eventCodeId: "event-a", activeFlag: true, startDate: new Date("2026-09-01T00:00:00Z"), endDate: new Date("2026-09-30T00:00:00Z") };
const transactionDate = new Date("2026-09-15T00:00:00Z");
const classify = (overrides: Partial<Parameters<typeof assertCampaignClassification>[0]> = {}) => assertCampaignClassification({
  eventCode: event, campaignId: september.id, campaign: september, transactionDate, requiresClassification: true, requireComplete: true, ...overrides
});

test("STANDARD needs no Campaign and rejects a Campaign assignment", () => {
  assert.doesNotThrow(() => classify({ eventCode: { id: "standard", eventType: "STANDARD", activeFlag: true }, campaignId: null, campaign: null }));
  assert.throws(() => classify({ eventCode: { id: "standard", eventType: "STANDARD", activeFlag: true } }), /Only CAMPAIGN/);
  assert.doesNotThrow(() => classify({ requiresClassification: false, eventCode: null, campaignId: null }));
});

test("CAMPAIGN requires a matching operator selection", () => {
  assert.throws(() => classify({ campaignId: null, campaign: null }), /Campaign is required/);
  assert.throws(() => classify({ campaign: { ...september, eventCodeId: "event-b" } }), /does not belong/);
  assert.doesNotThrow(() => classify());
  assert.doesNotThrow(() => classify({ campaignId: null, campaign: null, requireComplete: false }));
});

test("Campaign eligibility uses transaction date and preserves unchanged historical assignment", () => {
  assert.doesNotThrow(() => classify({ transactionDate: new Date("2026-09-30T00:00:00Z") }));
  assert.throws(() => classify({ transactionDate: new Date("2026-10-01T00:00:00Z") }), /not valid/);
  assert.throws(() => classify({ campaign: { ...september, activeFlag: false } }), /inactive/);
  assert.doesNotThrow(() => classify({ campaign: { ...september, activeFlag: false }, historicalCampaignId: september.id }));
  assert.throws(() => classify({ eventCode: { ...event, activeFlag: false } }), /inactive or no longer available/);
  assert.doesNotThrow(() => classify({ eventCode: { ...event, activeFlag: false }, campaign: { ...september, activeFlag: false }, historicalCampaignId: september.id }));
});

test("Campaign validation and derived status cover open dates and target", () => {
  const base = { eventCodeId: "10000000-0000-4000-8000-000000000001", campaignName: "September", startDate: null, endDate: null, targetAmount: null, activeFlag: true, remark: null };
  assert.equal(campaignValueSchema.safeParse(base).success, true);
  assert.equal(campaignValueSchema.safeParse({ ...base, targetAmount: "0" }).success, false);
  assert.equal(campaignValueSchema.safeParse({ ...base, startDate: "2026-10-01", endDate: "2026-09-30" }).success, false);
  assert.equal(campaignDisplayStatus(september, "2026-08-31"), "SCHEDULED");
  assert.equal(campaignDisplayStatus(september, "2026-09-15"), "ACTIVE");
  assert.equal(campaignDisplayStatus(september, "2026-10-01"), "ENDED");
  assert.equal(campaignDisplayStatus({ ...september, activeFlag: false }, "2026-09-15"), "CLOSED");
});

test("official Campaign aggregate selects only FINALIZED positive non-excluded transactions", () => {
  assert.deepEqual(officialCampaignAmountWhere([september.id]), {
    eventCampaignId: { in: [september.id] }, status: "FINALIZED", originalAmount: { gt: 0 }, reconciliationExcludedAt: null
  });
});

test("correction approval applies Campaign A to B, rejection keeps official assignment", () => {
  const edit = readFileSync(new URL("../src/modules/reconciliation/edit-income/edit-income.repository.ts", import.meta.url), "utf8");
  const approval = readFileSync(new URL("../src/modules/approval/sign-approval/sign-approval.repository.ts", import.meta.url), "utf8");
  assert.match(edit, /beforeEventCampaignId: current\.eventCampaignId/);
  assert.match(edit, /proposedEventCampaignId: requested\.eventCampaignId/);
  assert.doesNotMatch(edit, /tx\.bankTransaction\.update\(/);
  assert.match(approval, /if \(input\.decision === "APPROVED"\)[\s\S]*eventCampaignId: item\.proposedEventCampaignId/);
  assert.match(approval, /fieldName: "event_campaign_id"/);
});
