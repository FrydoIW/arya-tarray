import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertCampaignClassification,
  campaignEligibilityReason,
  isCampaignEligibleForClassification,
  selectSingleEligibleCampaign
} from "../src/modules/reconciliation/campaign-classification.js";

type Campaign = { id: string; eventCodeId: string; activeFlag: boolean; startDate: Date | null; endDate: Date | null };
type CampaignEventLike = { id: string; eventType: string; activeFlag: boolean };

const campaignEvent: CampaignEventLike = { id: "event-campaign", eventType: "CAMPAIGN", activeFlag: true };
const inactiveCampaignEvent: CampaignEventLike = { ...campaignEvent, activeFlag: false };
const standardEvent: CampaignEventLike = { id: "event-standard", eventType: "STANDARD", activeFlag: true };
const timeBasedEvent: CampaignEventLike = { id: "event-time-based", eventType: "TIME_BASED", activeFlag: true };
const september: Campaign = { id: "campaign-september", eventCodeId: "event-campaign", activeFlag: true, startDate: new Date("2026-09-01T00:00:00Z"), endDate: new Date("2026-09-30T00:00:00Z") };
const secondSeptember: Campaign = { ...september, id: "campaign-september-2" };
const openEnded: Campaign = { id: "campaign-open", eventCodeId: "event-campaign", activeFlag: true, startDate: null, endDate: null };
const transactionDate = new Date("2026-09-15T00:00:00Z");

function select(campaigns: Campaign[], eventCode: CampaignEventLike | null = campaignEvent, date: Date | null = transactionDate) {
  return selectSingleEligibleCampaign({ eventCode, campaigns, transactionDate: date });
}

test("exactly one eligible Campaign is selected for the transaction date", () => {
  assert.equal(select([september]), september.id);
  assert.equal(select([openEnded]), openEnded.id);
  assert.equal(select([september], campaignEvent, new Date("2026-09-01T00:00:00Z")), september.id);
  assert.equal(select([september], campaignEvent, new Date("2026-09-30T00:00:00Z")), september.id);
});

test("zero eligible Campaigns keep the assignment null", () => {
  assert.equal(select([]), null);
  assert.equal(select([{ ...september, startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-10-31T00:00:00Z") }]), null);
  assert.equal(select([september], campaignEvent, null), null);
});

test("two or more eligible Campaigns are never guessed", () => {
  assert.equal(select([september, secondSeptember]), null);
  assert.equal(select([september, openEnded]), null);
});

test("inactive, foreign, and parent-inactive Campaigns are ignored", () => {
  assert.equal(select([{ ...september, activeFlag: false }]), null);
  assert.equal(select([{ ...september, eventCodeId: "event-other" }]), null);
  assert.equal(select([september], inactiveCampaignEvent), null);
  assert.equal(select([september], standardEvent), null);
  assert.equal(select([september], timeBasedEvent), null);
});

test("canonical eligibility reasons stay stable", () => {
  const reason = (campaign: Campaign | null, eventCode: CampaignEventLike | null = campaignEvent, date: Date | null = transactionDate) =>
    campaignEligibilityReason({ eventCode, campaign, transactionDate: date });
  assert.equal(reason(september), "ELIGIBLE");
  assert.equal(reason(september, standardEvent), "EVENT_NOT_CAMPAIGN");
  assert.equal(reason(september, inactiveCampaignEvent), "EVENT_INACTIVE");
  assert.equal(reason(null), "CAMPAIGN_MISSING");
  assert.equal(reason({ ...september, eventCodeId: "event-other" }), "CAMPAIGN_OWNERSHIP");
  assert.equal(reason({ ...september, activeFlag: false }), "CAMPAIGN_INACTIVE");
  assert.equal(reason(september, campaignEvent, null), "DATE_MISSING");
  assert.equal(reason({ ...september, startDate: new Date("2026-10-01T00:00:00Z") }), "DATE_OUT_OF_PERIOD");
  assert.equal(isCampaignEligibleForClassification({ eventCode: campaignEvent, campaign: september, transactionDate }), true);
});

test("RAW Execute revalidation rejects invalid selected Campaigns", () => {
  const rawExecute = (overrides: Partial<Parameters<typeof assertCampaignClassification>[0]> = {}) => assertCampaignClassification({
    eventCode: campaignEvent,
    campaignId: september.id,
    campaign: september,
    transactionDate,
    requiresClassification: true,
    requireComplete: true,
    historicalCampaignId: null,
    ...overrides
  });
  assert.doesNotThrow(() => rawExecute());
  assert.throws(() => rawExecute({ campaign: { ...september, activeFlag: false } }), /The selected Campaign is inactive/);
  assert.throws(() => rawExecute({ transactionDate: new Date("2026-10-01T00:00:00Z") }), /Campaign is not valid on the transaction date/);
  assert.throws(() => rawExecute({ transactionDate: null }), /Transaction date is required to select a Campaign/);
  assert.throws(() => rawExecute({ eventCode: inactiveCampaignEvent }), /The selected Final Event is inactive or no longer available/);
  assert.throws(() => rawExecute({ campaign: { ...september, eventCodeId: "event-other" } }), /Campaign does not belong to the selected Event Code/);
});

test("historical exemption remains only for already official Campaign assignments", () => {
  assert.doesNotThrow(() => assertCampaignClassification({
    eventCode: inactiveCampaignEvent,
    campaignId: september.id,
    campaign: { ...september, activeFlag: false },
    transactionDate: null,
    requiresClassification: true,
    requireComplete: true,
    historicalCampaignId: september.id
  }));
});

test("STANDARD and TIME_BASED classification behavior is unchanged", () => {
  assert.doesNotThrow(() => assertCampaignClassification({ eventCode: standardEvent, campaignId: null, campaign: null, transactionDate, requiresClassification: true, requireComplete: true }));
  assert.throws(() => assertCampaignClassification({ eventCode: standardEvent, campaignId: september.id, campaign: september, transactionDate, requiresClassification: true, requireComplete: true }), /Only CAMPAIGN Event Codes may have a Campaign/);
  assert.throws(() => assertCampaignClassification({ eventCode: timeBasedEvent, campaignId: september.id, campaign: september, transactionDate, requiresClassification: true, requireComplete: true }), /Only CAMPAIGN Event Codes may have a Campaign/);
  assert.doesNotThrow(() => assertCampaignClassification({ eventCode: null, campaignId: null, campaign: null, transactionDate, requiresClassification: false, requireComplete: true }));
});

test("upload resolves the Campaign inside the persistence transaction and RAW Execute fully revalidates", () => {
  const repository = readFileSync(new URL("../src/modules/reconciliation/statement-upload/statement-upload.repository.ts", import.meta.url), "utf8");
  const persistStart = repository.indexOf("export async function persistParsedStatement");
  const finalEventStart = repository.indexOf("export async function updateTransactionFinalEventAtomic");
  const executeStart = repository.indexOf("export async function executeStatementAtomic");
  const persistBlock = repository.slice(persistStart, finalEventStart);
  const finalEventBlock = repository.slice(finalEventStart, executeStart);
  const executeBlock = repository.slice(executeStart);
  assert.match(finalEventBlock, /activeFlag: true/);
  assert.match(persistBlock, /selectSingleEligibleCampaign/);
  assert.match(persistBlock, /tx\.eventCampaign\.findMany/);
  assert.match(persistBlock, /eventCampaignId:/);
  assert.match(executeBlock, /historicalCampaignId: null/);
  assert.match(executeBlock, /activeFlag: true/);
});

test("Event Code : Campaign remains a 1:N relation", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(schema, /campaigns EventCampaign\[\]/);
  assert.match(schema, /eventCampaignId\s+String\?\s+@map\("event_campaign_id"\)/);
});
