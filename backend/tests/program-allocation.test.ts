import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { campaignAcceptsNewParticipation, createCampaignParticipationRecord, eligibleCampaignParticipationOptions, initialTimeBasedSubscriptionState, sponsorshipStatus, summarizeAppliedHistoricalRates, summarizeCampaignAllocations, summarizeCarrySummary, summarizeContributions, summarizeSubscriptionLedger } from "../src/modules/member/data/member-data.service.js";
import { campaignParticipationCreateSchema, subscriptionCreateSchema, subscriptionUpdateSchema } from "../src/modules/member/data/member-data.schema.js";
import { centsToMoney, coverageSourceLabel, createIdempotencyKey, dependencyConflictHint, destinationUnitRequirement, ledgerEntryKind, ledgerEntryLabel, moneyToCents, subscriptionLabel, transferDestinationCandidates, transferEstimate, validateTransferAmount } from "../../frontend/src/features/member/data/program-allocation.utils.js";

const d = (value: string) => new Prisma.Decimal(value);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function containsBigInt(value: unknown): boolean {
  if (typeof value === "bigint") return true;
  if (Array.isArray(value)) return value.some(containsBigInt);
  return Boolean(value) && typeof value === "object"
    && Object.values(value as Record<string, unknown>).some(containsBigInt);
}

test("subscription ledger totals separate principal, coverage consumption, and transfers", () => {
  const totals = summarizeSubscriptionLedger([
    { subscriptionId: "sub-a", entryType: "PAYMENT", _sum: { amountDelta: d("250000.00") } },
    { subscriptionId: "sub-a", entryType: "COVERAGE_USE", _sum: { amountDelta: d("-150000.00") } },
    { subscriptionId: "sub-a", entryType: "TRANSFER_OUT", _sum: { amountDelta: d("-40000.00") } },
    { subscriptionId: "sub-a", entryType: "TRANSFER_IN", _sum: { amountDelta: d("10000.00") } },
    { subscriptionId: "sub-b", entryType: "PAYMENT", _sum: { amountDelta: null } }
  ]);
  assert.deepEqual(totals.get("sub-a"), { principal: 25000000n, consumed: 15000000n, transferIn: 1000000n, transferOut: 4000000n, carry: 7000000n });
  assert.deepEqual(totals.get("sub-b"), { principal: 0n, consumed: 0n, transferIn: 0n, transferOut: 0n, carry: 0n });
});

test("carry totals stay the signed sum of every active entry type", () => {
  const totals = summarizeSubscriptionLedger([
    { subscriptionId: "sub-a", entryType: "FUTURE_DEBIT", _sum: { amountDelta: d("-1250.50") } },
    { subscriptionId: "sub-a", entryType: "PAYMENT", _sum: { amountDelta: d("2000.50") } }
  ]);
  assert.equal(totals.get("sub-a")!.carry, 75000n);
  assert.equal(totals.get("sub-a")!.consumed, 0n);
});

test("donor carry summary keeps positive TIME_BASED and Campaign source provenance exact", () => {
  const summary = summarizeCarrySummary({
    subscriptions: [
      { subscriptionId: "sub-005", event: { code: "005", eventName: "Rupang Manjushri" }, referenceNo: "005", displayName: null,
        carryBalance: "150005.00", activeFlag: false, eventActiveFlag: false, status: "INACTIVE" },
      { subscriptionId: "sub-zero", event: { code: "007", eventName: "Zero" }, referenceNo: null, displayName: null,
        carryBalance: "0.00", activeFlag: true, eventActiveFlag: true, status: "ACTIVE" }
    ],
    campaigns: [{ campaignId: "campaign-006", eventCode: "006", eventName: "Resident Meals", campaignName: "September",
      carryBalance: "50003.00", status: "ACTIVE" }]
  });

  assert.deepEqual({ total: summary.total, timeBased: summary.timeBased, campaign: summary.campaign },
    { total: "200008.00", timeBased: "150005.00", campaign: "50003.00" });
  assert.deepEqual(summary.sources.map(source => ({ type: source.sourceType, id: source.sourceSubscriptionId ?? source.sourceCampaignId,
    balance: source.balance, active: source.activeFlag })), [
    { type: "CAMPAIGN", id: "campaign-006", balance: "50003.00", active: true },
    { type: "TIME_BASED", id: "sub-005", balance: "150005.00", active: false }
  ]);
  assert.equal(summary.sources.reduce((total, source) => total + BigInt(source.balance.replace(".", "")), 0n), 20000800n);
});

test("donor carry summary reflects transfer and reversal without duplicating buckets", () => {
  const source = (carryBalance: string) => ({ subscriptionId: "sub-005", event: { code: "005", eventName: "Rupang Manjushri" },
    referenceNo: null, displayName: null, carryBalance, activeFlag: true, eventActiveFlag: true, status: "ACTIVE" });
  const destination = (carryBalance: string) => ({ subscriptionId: "sub-001", event: { code: "001", eventName: "Rupang Buddha Shakyamuni" },
    referenceNo: null, displayName: null, carryBalance, activeFlag: true, eventActiveFlag: true, status: "ACTIVE" });
  const summarize = (sourceCarry: string, destinationCarry: string) => summarizeCarrySummary({ subscriptions: [source(sourceCarry), destination(destinationCarry)], campaigns: [] });
  assert.equal(summarize("150005.00", "0.00").total, "150005.00");
  assert.deepEqual({ total: summarize("0.00", "150005.00").total, sources: summarize("0.00", "150005.00").sources.map(row => row.sourceSubscriptionId) },
    { total: "150005.00", sources: ["sub-001"] });
  assert.deepEqual({ total: summarize("150005.00", "0.00").total, sources: summarize("150005.00", "0.00").sources.map(row => row.sourceSubscriptionId) },
    { total: "150005.00", sources: ["sub-005"] });
});

test("historical rate uses COVERAGE_USE consumed amounts and immutable snapshots", () => {
  const rates = summarizeAppliedHistoricalRates([
    { subscriptionId: "direct", carryTransferId: null, entryStatus: "ACTIVE", amountDelta: d("-1100000.00"),
      effectiveDate: new Date("2026-09-01T00:00:00.000Z"), unitAmountSnapshot: d("100000.00"), durationMonthsSnapshot: 2,
      voidReason: null, bankTransaction: { referenceNo: "DIRECT-1" } },
    { subscriptionId: "carry", carryTransferId: "transfer-1", entryStatus: "ACTIVE", amountDelta: d("-150000.00"),
      effectiveDate: new Date("2026-09-02T00:00:00.000Z"), unitAmountSnapshot: d("50000.00"), durationMonthsSnapshot: 1,
      voidReason: null, bankTransaction: null },
    { subscriptionId: "snapshot", carryTransferId: null, entryStatus: "VOIDED", amountDelta: d("-200000.00"),
      effectiveDate: new Date("2026-09-03T00:00:00.000Z"), unitAmountSnapshot: d("100000.00"), durationMonthsSnapshot: 2,
      voidReason: "Correction", bankTransaction: { referenceNo: "OLD-RATE" } }
  ]);
  assert.deepEqual(rates.get("direct"), [{ source: "PAYMENT", status: "ACTIVE", amountApplied: "1100000.00", effectiveDate: "2026-09-01",
    unitAmount: "100000.00", durationMonths: 2, referenceNo: "DIRECT-1", voidReason: null }]);
  assert.deepEqual(rates.get("carry"), [{ source: "CARRY_TRANSFER", status: "ACTIVE", amountApplied: "150000.00", effectiveDate: "2026-09-02",
    unitAmount: "50000.00", durationMonths: 1, referenceNo: null, voidReason: null }]);
  assert.equal(rates.get("snapshot")![0]!.unitAmount, "100000.00", "historical snapshot is not derived from a current Time Rule");
});

test("contribution overview keeps event type, category, campaign status, and totals", () => {
  const result = summarizeContributions({
    groups: [
      { eventCodeId: "e1", eventCampaignId: null, _sum: { originalAmount: d("250004.00") }, _count: { _all: 2 } },
      { eventCodeId: "e2", eventCampaignId: "c1", _sum: { originalAmount: d("100.00") }, _count: { _all: 1 } },
      { eventCodeId: "missing", eventCampaignId: null, _sum: { originalAmount: null }, _count: { _all: 1 } }
    ],
    events: [
      { id: "e1", code: "004", eventName: "Rupang Tara Hijau", eventType: "TIME_BASED", category: null },
      { id: "e2", code: "012", eventName: "Bodhi Campaign", eventType: "CAMPAIGN", category: "  " }
    ],
    campaigns: [{ id: "c1", eventCodeId: "e2", campaignName: "Bodhi 2026", activeFlag: true, startDate: new Date("2026-10-01T00:00:00.000Z"), endDate: null }],
    today: "2026-09-19"
  });
  assert.deepEqual(result, [
    { eventCodeId: "e1", eventCode: "004", eventName: "Rupang Tara Hijau", eventType: "TIME_BASED", category: "Uncategorized",
      campaign: null, totalAmount: "250004.00", transactionCount: 2 },
    { eventCodeId: "e2", eventCode: "012", eventName: "Bodhi Campaign", eventType: "CAMPAIGN", category: "Uncategorized",
      campaign: { campaignId: "c1", campaignName: "Bodhi 2026", displayStatus: "SCHEDULED" }, totalAmount: "100.00", transactionCount: 1 }
  ]);
});

test("campaign overview status follows the shared campaign semantics", () => {
  const event = { id: "e2", code: "012", eventName: "Bodhi Campaign", eventType: "CAMPAIGN", category: "Bodhi" };
  const group = { eventCodeId: "e2", eventCampaignId: "c1", _sum: { originalAmount: d("10.00") }, _count: { _all: 1 } };
  const status = (campaign: { activeFlag: boolean; startDate: Date | null; endDate: Date | null }) =>
    summarizeContributions({ groups: [group], events: [event], campaigns: [{ id: "c1", eventCodeId: "e2", campaignName: "Bodhi", ...campaign }], today: "2026-09-19" })[0]!.campaign!.displayStatus;
  assert.equal(status({ activeFlag: false, startDate: null, endDate: null }), "CLOSED");
  assert.equal(status({ activeFlag: true, startDate: new Date("2026-10-01T00:00:00.000Z"), endDate: null }), "SCHEDULED");
  assert.equal(status({ activeFlag: true, startDate: null, endDate: new Date("2026-09-01T00:00:00.000Z") }), "ENDED");
  assert.equal(status({ activeFlag: true, startDate: null, endDate: null }), "ACTIVE");
});

test("Campaign donor cards show participation only, separate direct and carry amounts, and retain historical status", () => {
  const events = [{ id: "e-campaign", code: "012", eventName: "Campaign Event", eventType: "CAMPAIGN", category: null }];
  const campaignMasters = [{ id: "c-historical", eventCodeId: "e-campaign", campaignName: "Past Campaign", activeFlag: true,
    startDate: null, endDate: new Date("2026-08-31T00:00:00.000Z"),
    eventCode: { code: "012", eventName: "Campaign Event", eventType: "CAMPAIGN", activeFlag: true } },
  { id: "c-unrelated", eventCodeId: "e-campaign", campaignName: "Unrelated Active", activeFlag: true,
    startDate: null, endDate: null, eventCode: { code: "012", eventName: "Campaign Event", eventType: "CAMPAIGN", activeFlag: true } }];
  const contributions = summarizeContributions({
    groups: [{ eventCodeId: "e-campaign", eventCampaignId: "c-historical", _sum: { originalAmount: d("120.00") }, _count: { _all: 1 } }],
    events, campaigns: campaignMasters, today: "2026-09-19"
  });
  const allocations = [
    { id: "a1", eventCampaignId: "c-historical", amountDelta: d("500.00"), allocationType: "CARRY_TRANSFER", allocationStatus: "ACTIVE",
      effectiveDate: new Date("2026-08-01T00:00:00.000Z"), reason: "Carry", eventCampaign: campaignMasters[0] },
    { id: "a2", eventCampaignId: "c-historical", amountDelta: d("-100.00"), allocationType: "CARRY_REVERSAL", allocationStatus: "ACTIVE",
      effectiveDate: new Date("2026-08-02T00:00:00.000Z"), reason: "Reverse", eventCampaign: campaignMasters[0] },
    { id: "a3", eventCampaignId: "c-historical", amountDelta: d("40.00"), allocationType: "CARRY_TRANSFER", allocationStatus: "VOIDED",
      effectiveDate: new Date("2026-08-03T00:00:00.000Z"), reason: "Voided", eventCampaign: campaignMasters[0] }
  ];
  const result = summarizeCampaignAllocations({ contributions, allocations, campaignMasters, today: "2026-09-19" });
  assert.equal(result.length, 1, "a configured master alone must not inject a donor card");
  assert.equal(result[0].status, "ENDED");
  assert.equal(result[0].directContribution, "120.00");
  assert.equal(result[0].allocatedFromCarry, "400.00");
  assert.equal(result[0].totalAllocation, "520.00");
  assert.equal(result[0].allocationHistory.length, 3, "voided allocation evidence stays discoverable");
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(containsBigInt(result), false);
  assert.equal("legacyApplied" in result[0], false);
  assert.equal(summarizeCampaignAllocations({ contributions: [], allocations: [], campaignMasters, today: "2026-09-19" }).length, 0);
});

test("TIME_BASED carry allocated to Campaign stays serializable without changing contribution evidence", () => {
  const campaign = { id: "campaign-006", eventCodeId: "event-006", campaignName: "Kebutuhan Makan Bhikku Resident", targetAmount: d("50003.00"),
    activeFlag: true, startDate: null, endDate: null, eventCode: { code: "006", eventName: "Kebutuhan Makan Bhikku Resident", eventType: "CAMPAIGN", activeFlag: true } };
  const contributions = summarizeContributions({
    groups: [{ eventCodeId: "event-003", eventCampaignId: null, _sum: { originalAmount: d("1150003.00") }, _count: { _all: 1 } }],
    events: [{ id: "event-003", code: "003", eventName: "Rupang Guru Rinpoche", eventType: "TIME_BASED", category: null }],
    campaigns: [], today: "2026-09-25"
  });
  const result = summarizeCampaignAllocations({ contributions, campaignMasters: [campaign], allocations: [{ id: "carry-50003", eventCampaignId: campaign.id,
    amountDelta: d("50003.00"), allocationType: "CARRY_TRANSFER", allocationStatus: "ACTIVE", effectiveDate: new Date("2026-09-25T00:00:00.000Z"),
    reason: "Carry TIME_BASED 003", eventCampaign: campaign }], today: "2026-09-25" });

  assert.equal(result[0].allocatedFromCarry, "50003.00");
  assert.equal(result[0].directContribution, "0.00");
  assert.equal(contributions.find(row => row.eventType === "TIME_BASED")?.totalAmount, "1150003.00");
  assert.equal(contributions.some(row => row.eventType === "CAMPAIGN"), false);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(containsBigInt(result), false);
  assert.equal("legacyApplied" in result[0], false);
});

test("Campaign public cards serialize direct, wallet, participation, and mixed sources", () => {
  const campaign = (id: string, name: string) => ({ id, eventCodeId: "event-006", campaignName: name, targetAmount: null,
    activeFlag: true, startDate: null, endDate: null, eventCode: { code: "006", eventName: "Campaign 006", eventType: "CAMPAIGN", activeFlag: true } });
  const direct = campaign("campaign-direct", "Direct");
  const wallet = campaign("campaign-wallet", "Wallet");
  const participation = campaign("campaign-participation", "Participation");
  const mixed = campaign("campaign-mixed", "Mixed");
  const masters = [direct, wallet, participation, mixed];
  const contributions = summarizeContributions({
    groups: [
      { eventCodeId: "event-006", eventCampaignId: direct.id, _sum: { originalAmount: d("120.00") }, _count: { _all: 1 } },
      { eventCodeId: "event-006", eventCampaignId: mixed.id, _sum: { originalAmount: d("200.00") }, _count: { _all: 1 } }
    ],
    events: [{ id: "event-006", code: "006", eventName: "Campaign 006", eventType: "CAMPAIGN", category: null }],
    campaigns: masters, today: "2026-09-25"
  });
  const result = summarizeCampaignAllocations({ contributions, campaignMasters: masters,
    participations: [{ eventCampaignId: participation.id }],
    allocations: [{ id: "mixed-carry", eventCampaignId: mixed.id, amountDelta: d("50.00"), allocationType: "CARRY_TRANSFER", allocationStatus: "ACTIVE",
      effectiveDate: new Date("2026-09-25T00:00:00.000Z"), reason: "Carry", eventCampaign: mixed }],
    walletEntries: [{ eventCampaignId: wallet.id, amountDelta: d("25.00"), entryStatus: "ACTIVE" }, { eventCampaignId: mixed.id, amountDelta: d("10.00"), entryStatus: "ACTIVE" }],
    legacyContributionGroups: [{ eventCampaignId: mixed.id, _sum: { originalAmount: d("30.00") } }], today: "2026-09-25" });

  assert.equal(result.length, 4);
  assert.equal(result.find(row => row.campaignId === direct.id)?.directContribution, "120.00");
  assert.equal(result.find(row => row.campaignId === wallet.id)?.carryBalance, "25.00");
  assert.equal(result.find(row => row.campaignId === participation.id)?.totalAllocation, "0.00");
  assert.deepEqual(result.find(row => row.campaignId === mixed.id) && {
    directContribution: result.find(row => row.campaignId === mixed.id)!.directContribution,
    allocatedFromCarry: result.find(row => row.campaignId === mixed.id)!.allocatedFromCarry,
    carryBalance: result.find(row => row.campaignId === mixed.id)!.carryBalance,
    appliedToCampaign: result.find(row => row.campaignId === mixed.id)!.appliedToCampaign
  }, { directContribution: "200.00", allocatedFromCarry: "50.00", carryBalance: "10.00", appliedToCampaign: "80.00" });
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(containsBigInt(result), false);
  assert.equal(result.every(row => !("legacyApplied" in row) && !("directApplied" in row)), true);
});

test("manual Campaign participation persists without financial rows and merges with later allocation", async () => {
  const participations: Array<{ id: string; memberId: string; eventCampaignId: string; activeFlag: boolean; remark: string | null; createdById: string }> = [];
  const financialWrites = { bank: 0, allocation: 0, ledger: 0, transfer: 0 };
  const campaign = { id: "campaign-manual", activeFlag: true, startDate: null, endDate: null,
    eventCode: { eventType: "CAMPAIGN", activeFlag: true } };
  const tx = {
    member: { findUnique: async () => ({ activeFlag: true }) },
    eventCampaign: { findUnique: async () => campaign },
    memberEventCampaignParticipation: {
      findUnique: async () => participations[0] ?? null,
      create: async ({ data }: { data: Omit<typeof participations[number], "id"> }) => {
        const row = { id: "participation-1", ...data }; participations.push(row); return row;
      }
    },
    bankTransaction: { findFirst: async () => null, create: async () => { financialWrites.bank++; } },
    memberEventCampaignAllocation: { findFirst: async () => null, create: async () => { financialWrites.allocation++; } },
    memberEventBalanceLedger: { create: async () => { financialWrites.ledger++; } },
    memberEventCarryTransfer: { create: async () => { financialWrites.transfer++; } }
  } as unknown as Prisma.TransactionClient;

  await createCampaignParticipationRecord(tx, "member-a", { eventCampaignId: campaign.id, remark: "Resident support" }, "admin");
  assert.deepEqual(participations, [{ id: "participation-1", memberId: "member-a", eventCampaignId: campaign.id,
    activeFlag: true, remark: "Resident support", createdById: "admin" }]);
  await assert.rejects(() => createCampaignParticipationRecord(tx, "member-a", { eventCampaignId: campaign.id, remark: null }, "admin"), /sudah berpartisipasi/);
  assert.deepEqual(financialWrites, { bank: 0, allocation: 0, ledger: 0, transfer: 0 });

  const campaignMaster = [{ id: campaign.id, eventCampaignId: campaign.id, eventCodeId: "e-campaign", campaignName: "Resident Meals",
    activeFlag: true, startDate: null, endDate: null,
    eventCode: { code: "006", eventName: "Resident Meals", eventType: "CAMPAIGN", activeFlag: true } }];
  const contributionInput = { groups: [], events: [{ id: "e-campaign", code: "006", eventName: "Resident Meals", eventType: "CAMPAIGN", category: null }],
    campaigns: [{ id: campaign.id, eventCodeId: "e-campaign", campaignName: "Resident Meals", activeFlag: true, startDate: null, endDate: null }], today: "2026-09-19" };
  const contributions = summarizeContributions(contributionInput);
  const readModelInput = { contributions, participations, allocations: [], campaignMasters: campaignMaster, today: "2026-09-19" };
  const afterReload = summarizeCampaignAllocations(readModelInput);
  assert.deepEqual(summarizeCampaignAllocations(readModelInput), afterReload, "reload preserves one participation card");
  assert.equal(afterReload.length, 1);
  assert.deepEqual({ status: afterReload[0].status, direct: afterReload[0].directContribution,
    allocated: afterReload[0].allocatedFromCarry, total: afterReload[0].totalAllocation },
  { status: "ACTIVE", direct: "0.00", allocated: "0.00", total: "0.00" });

  const afterCarry = summarizeCampaignAllocations({ ...readModelInput, allocations: [{ id: "allocation-1", eventCampaignId: campaign.id,
    amountDelta: d("50003.00"), allocationType: "CARRY_TRANSFER", allocationStatus: "ACTIVE", effectiveDate: new Date("2026-09-01T00:00:00Z"),
    reason: "Carry", eventCampaign: { ...campaignMaster[0] } }] });
  assert.equal(afterCarry.length, 1, "carry allocation merges into the existing participation card");
  assert.equal(afterCarry[0].directContribution, "0.00");
  assert.equal(afterCarry[0].allocatedFromCarry, "50003.00");
  assert.equal(afterCarry[0].totalAllocation, "50003.00");
  assert.deepEqual(summarizeContributions(contributionInput), contributions, "manual participation and carry do not change contribution totals");
});

test("Campaign participation options exclude existing cards and require a currently valid Campaign", () => {
  const active = { activeFlag: true, startDate: null, endDate: null, eventCode: { activeFlag: true } };
  const options = ["direct", "allocated", "manual", "new", "inactive", "scheduled", "ended", "parent-inactive"]
    .map(id => ({ id, ...active, eventCode: { ...active.eventCode } }));
  options.find(row => row.id === "inactive")!.activeFlag = false;
  options.find(row => row.id === "scheduled")!.startDate = new Date("2026-10-01T00:00:00Z");
  options.find(row => row.id === "ended")!.endDate = new Date("2026-09-01T00:00:00Z");
  options.find(row => row.id === "parent-inactive")!.eventCode.activeFlag = false;
  assert.deepEqual(eligibleCampaignParticipationOptions(options, ["direct", "allocated", "manual"], "2026-09-19").map(row => row.id), ["new"]);
  assert.equal(campaignParticipationCreateSchema.safeParse({ eventCampaignId: "00000000-0000-0000-0000-000000000006", remark: null }).success, true);
  assert.equal(campaignParticipationCreateSchema.safeParse({ eventCampaignId: "00000000-0000-0000-0000-000000000006", remark: null, amount: "0.00" }).success, false);
  assert.equal(campaignAcceptsNewParticipation({ activeFlag: true, startDate: null, endDate: null }, true, "2026-09-19"), true);
  assert.equal(campaignAcceptsNewParticipation({ activeFlag: false, startDate: null, endDate: null }, true, "2026-09-19"), false);
  assert.equal(campaignAcceptsNewParticipation({ activeFlag: true, startDate: new Date("2026-10-01T00:00:00Z"), endDate: null }, true, "2026-09-19"), false);
  assert.equal(campaignAcceptsNewParticipation({ activeFlag: true, startDate: null, endDate: new Date("2026-09-01T00:00:00Z") }, true, "2026-09-19"), false);
  assert.equal(campaignAcceptsNewParticipation({ activeFlag: true, startDate: null, endDate: null }, false, "2026-09-19"), false);
});

test("Campaign section remains participation-first while Carry allocation moves to donor summary", () => {
  const screen = read("../../frontend/src/features/member/data/components/ProgramAllocation.tsx");
  const section = screen.slice(screen.indexOf("function CampaignSection"), screen.indexOf("export function ProgramAllocation"));
  const timeBasedCard = read("../../frontend/src/features/member/data/components/TimeBasedProgramCard.tsx");
  const api = read("../../frontend/src/features/member/data/api/member-data.api.ts");
  assert.match(section, /Belum ada Campaign/);
  assert.match(section, /Tambah Campaign/);
  assert.match(screen, /api\.createCampaignParticipation\(memberId/);
  assert.match(screen, /campaignParticipationOptions/);
  assert.match(screen, /Belum ada Campaign aktif yang dapat diikuti saat ini/);
  assert.match(screen, /Campaign ditambahkan sebagai partisipasi donatur/);
  assert.match(screen, /tidak membuat transaksi bank atau alokasi dana/i);
  assert.match(api, /\/campaign-participations/);
  assert.doesNotMatch(timeBasedCard, /Alokasikan Carry/);
  assert.match(section, /Kontribusi langsung/);
  assert.match(section, /Terpakai untuk Campaign/);
  assert.match(section, /Alokasi dari Carry/);
  assert.match(section, /Saldo Carry/);
  assert.doesNotMatch(section, /canOfferCampaignTransfer\(/);
  assert.doesNotMatch(section, /onCarry\(row\)/);
  assert.doesNotMatch(section.slice(0, section.indexOf("campaigns.length ?")), /Alokasikan Carry/);
  assert.match(screen, /CarryDonorSummary/);
  assert.match(screen, /createCampaignWalletTransfer\(memberId, sourceCampaignId/);
});

test("ledger labels cover every known entry type and never mislabel unknown types as Coverage Use", () => {
  assert.equal(ledgerEntryLabel("PAYMENT"), "Payment");
  assert.equal(ledgerEntryLabel("COVERAGE_USE"), "Coverage Use");
  assert.equal(ledgerEntryLabel("TRANSFER_IN"), "Transfer In");
  assert.equal(ledgerEntryLabel("TRANSFER_OUT"), "Transfer Out");
  assert.equal(ledgerEntryLabel("FUTURE_DEBIT"), "Other · FUTURE_DEBIT");
  assert.notEqual(ledgerEntryLabel("FUTURE_DEBIT"), "Coverage Use");
  assert.equal(ledgerEntryKind("PAYMENT"), "CREDIT");
  assert.equal(ledgerEntryKind("TRANSFER_IN"), "CREDIT");
  assert.equal(ledgerEntryKind("COVERAGE_USE"), "DEBIT");
  assert.equal(ledgerEntryKind("TRANSFER_OUT"), "DEBIT");
  assert.equal(ledgerEntryKind("FUTURE_DEBIT"), "OTHER");
});

test("money helpers keep exact decimal math for transfer validation", () => {
  assert.equal(moneyToCents("100000.00"), 10000000n);
  assert.equal(moneyToCents("250004"), 25000400n);
  assert.equal(moneyToCents("-1250.5"), -125050n);
  assert.equal(moneyToCents("abc"), null);
  assert.equal(centsToMoney(75000n), "750.00");
  assert.equal(validateTransferAmount("0", "100000.00"), "Masukkan nominal transfer yang valid.");
  assert.equal(validateTransferAmount("-1", "100000.00"), "Masukkan nominal transfer yang valid.");
  assert.equal(validateTransferAmount("100001", "100000.00"), "Nominal transfer melebihi carry yang tersedia.");
  assert.equal(validateTransferAmount("40000", "100000.00"), null);
  assert.equal(validateTransferAmount("100000.00", "100000.00"), null);
});

test("transfer estimate pools destination carry, computes whole units, and keeps the remainder", () => {
  assert.deepEqual(transferEstimate({ amount: "100000.00", destinationCarry: "40000.00", unitAmount: "100000.00", durationMonths: 2 }),
    { units: 1, months: 2, amountApplied: "100000.00", remainingCarry: "40000.00" });
  assert.deepEqual(transferEstimate({ amount: "250000.00", destinationCarry: "0.00", unitAmount: "100000.00", durationMonths: 1 }),
    { units: 2, months: 2, amountApplied: "200000.00", remainingCarry: "50000.00" });
  assert.equal(transferEstimate({ amount: "99999.99", destinationCarry: "0.00", unitAmount: "100000.00", durationMonths: 2 })!.units, 0);
  assert.equal(transferEstimate({ amount: "0", destinationCarry: "0.00", unitAmount: "100000.00", durationMonths: 2 }), null);
  assert.equal(transferEstimate({ amount: "1000", destinationCarry: "0.00", unitAmount: "0.00", durationMonths: 2 }), null);
});

test("transfer destinations exclude the source, inactive programs, inactive Events, non-TIME_BASED programs, and programs without an active rule", () => {
  const candidates = transferDestinationCandidates([
    { subscriptionId: "source", activeFlag: true, event: { eventType: "TIME_BASED" }, timeRule: { unitAmount: "100000", durationMonths: 2 } },
    { subscriptionId: "inactive", activeFlag: false, event: { eventType: "TIME_BASED" }, timeRule: { unitAmount: "100000", durationMonths: 2 } },
    { subscriptionId: "no-rule", activeFlag: true, event: { eventType: "TIME_BASED" }, timeRule: null },
    { subscriptionId: "inactive-event", activeFlag: true, eventActiveFlag: false, event: { eventType: "TIME_BASED" }, timeRule: { unitAmount: "100000", durationMonths: 1 } },
    { subscriptionId: "standard", activeFlag: true, event: { eventType: "STANDARD" }, timeRule: { unitAmount: "100000", durationMonths: 1 } },
    { subscriptionId: "campaign", activeFlag: true, event: { eventType: "CAMPAIGN" }, timeRule: { unitAmount: "100000", durationMonths: 1 } },
    { subscriptionId: "eligible", activeFlag: true, event: { eventType: "TIME_BASED" }, timeRule: { unitAmount: "500000", durationMonths: 1 } }
  ], "source");
  assert.deepEqual(candidates.map(row => row.subscriptionId), ["eligible"]);
});

test("wallet transfers into TIME BASED must satisfy the destination minimum unit", () => {
  assert.equal(destinationUnitRequirement("100000.00", "0.00", "150000.00"), "50000.00");
  assert.equal(destinationUnitRequirement("100000.00", "100000.00", "150000.00"), null);
  assert.equal(destinationUnitRequirement("50000.00", "100000.00", "150000.00"), null);
  assert.equal(destinationUnitRequirement("0.00", "0.00", "150000.00"), "150000.00");
  assert.equal(destinationUnitRequirement("abc", "0.00", "150000.00"), null);
});

test("dependency conflicts surface the unwind-first domain hint without auto-unwind", () => {
  assert.match(dependencyConflictHint("Later balance actions depend on this Carry Transfer. Unwind the downstream transfers first.") ?? "", /Balikkan alokasi\/transfer lanjutan/);
  assert.match(dependencyConflictHint("TIME_BASED rebuild is blocked because active Carry Transfer dependencies must be unwound first.") ?? "", /Balikkan/);
  assert.equal(dependencyConflictHint("Nominal transfer melebihi carry yang tersedia."), null);
});

test("idempotency keys are unique per command and coverage/subscription labels stay readable", () => {
  const keys = new Set(Array.from({ length: 20 }, () => createIdempotencyKey()));
  assert.equal(keys.size, 20);
  assert.ok([...keys].every(key => key.length > 0));
  assert.equal(subscriptionLabel({ referenceNo: "R-1", displayName: "Utama", subscriptionId: "sub-1" }), "R-1");
  assert.equal(subscriptionLabel({ referenceNo: null, displayName: "Utama", subscriptionId: "sub-1" }), "Utama");
  assert.equal(subscriptionLabel({ referenceNo: null, displayName: null, subscriptionId: "sub-1" }), "sub-1");
  assert.equal(coverageSourceLabel("OPENING"), "Opening coverage");
  assert.equal(coverageSourceLabel("TRANSFER"), "Carry transfer allocation");
  assert.equal(coverageSourceLabel("TRANSACTION"), "Payment coverage");
});

test("STANDARD and CAMPAIGN contributions render without TIME_BASED entitlement controls", () => {
  const overview = read("../../frontend/src/features/member/data/components/ContributionOverview.tsx");
  const screen = read("../../frontend/src/features/member/data/components/ProgramAllocation.tsx");
  assert.match(overview, /TYPE_ORDER/);
  assert.match(overview, /Time-based/);
  assert.match(screen, /<CampaignSection/);
  assert.match(screen, /Partisipasi Campaign, target, dan carry donatur/);
  assert.match(screen, /allocatedFromCarry/);
  assert.doesNotMatch(overview, /Transfer Carry/);
  assert.doesNotMatch(overview, /carryBalance/);
  assert.doesNotMatch(overview, /coverage/);
  assert.doesNotMatch(overview, /Time Rule/);
});

test("TIME_BASED cards separate principal, consumed, carry, current rule, and historical rate", () => {
  const card = read("../../frontend/src/features/member/data/components/TimeBasedProgramCard.tsx");
  assert.match(card, /Current rule/);
  assert.match(card, /Historical rate follows recorded coverage consumption/);
  assert.match(card, /Dana masuk/);
  assert.match(card, /Consumed/);
  assert.match(card, /Saldo Carry Program/);
  assert.match(card, /sub\.appliedHistoricalRates/);
  assert.match(card, /ledgerEntryLabel\(entry\.type\)/);
  assert.match(card, /Balance history · Latest 24 entries/);
  assert.doesNotMatch(card, /Alokasikan Carry/);
});

test("TIME BASED program metadata keeps status and start date system-managed", () => {
  const screen = read("../../frontend/src/features/member/data/components/ProgramAllocation.tsx");
  const card = read("../../frontend/src/features/member/data/components/TimeBasedProgramCard.tsx");
  assert.match(screen, /<h2 id="pa-programs-title">TIME BASED<\/h2>/);
  assert.match(screen, /riwayat alokasi program donatur/);
  assert.match(screen, /statusReadOnly/);
  assert.match(screen, /formatDate\(editedSubscription\.startDate\)/);
  assert.doesNotMatch(screen, /type="checkbox"/);
  assert.doesNotMatch(screen, /activeFlag: form\.activeFlag/);
  assert.doesNotMatch(screen, /Mengikuti tanggal pembayaran pertama/);
  assert.match(card, /sub\.startDate \? formatDate\(sub\.startDate\) : "—"/);
  assert.equal(subscriptionUpdateSchema.safeParse({ referenceNo: null, displayName: null, remark: null }).success, true);
  assert.equal(subscriptionUpdateSchema.safeParse({ referenceNo: null, displayName: null, remark: null, activeFlag: false }).success, false);
  assert.equal(subscriptionUpdateSchema.safeParse({ referenceNo: null, displayName: null, remark: null, startDate: "2026-09-01" }).success, false);
  const create = { eventCodeId: "00000000-0000-0000-0000-000000000001", referenceNo: null, displayName: null, remark: null };
  assert.equal(subscriptionCreateSchema.safeParse(create).success, true);
  assert.equal(subscriptionCreateSchema.safeParse({ ...create, activeFlag: false }).success, false);
  assert.equal(subscriptionCreateSchema.safeParse({ ...create, startDate: "2026-09-01" }).success, false);
  assert.deepEqual(initialTimeBasedSubscriptionState(), { activeFlag: true, startDate: null });
  assert.match(screen, /mode === "create" \|\| editedSubscription\?\.activeFlag/);
  assert.match(screen, /Akan ditetapkan dari pembayaran pertama atau Opening Coverage/);
  assert.doesNotMatch(screen, /type="date" value=\{form\.startDate/);
});

test("TIME BASED program status follows system participation state, not coverage dates", () => {
  const manualProgram = initialTimeBasedSubscriptionState();
  assert.equal(manualProgram.activeFlag, true);
  assert.equal(manualProgram.startDate, null);
  assert.equal(sponsorshipStatus(manualProgram), "ACTIVE");
  const noEvidenceProgram = { ...manualProgram, validUntil: null, paymentCount: 0, coverageCount: 0, ledgerCount: 0, carryBalance: "0.00" };
  assert.equal(sponsorshipStatus(noEvidenceProgram), "ACTIVE", "null dates and no financial evidence do not make it pending");

  const autoCreatedProgram = { activeFlag: true, startDate: new Date("2026-09-01T00:00:00.000Z"), validUntil: new Date("2026-11-30T00:00:00.000Z") };
  assert.equal(sponsorshipStatus(autoCreatedProgram), "ACTIVE", "transaction-created programs remain active");
  assert.equal(sponsorshipStatus({ activeFlag: true, startDate: new Date("2027-01-01T00:00:00.000Z"), validUntil: new Date("2020-01-01T00:00:00.000Z") }),
    "ACTIVE", "participation status is independent of date-derived coverage state");
  assert.equal(sponsorshipStatus({ activeFlag: false }), "INACTIVE", "only the system-managed flag controls participation status");

  const emptyFinancialState = summarizeSubscriptionLedger([{ subscriptionId: "manual", entryType: "PAYMENT", _sum: { amountDelta: null } }]);
  assert.deepEqual(emptyFinancialState.get("manual"), { principal: 0n, consumed: 0n, transferIn: 0n, transferOut: 0n, carry: 0n });
});

test("global Transfer Carry modal requires source-aware explicit routing and validates destination, amount, and reason", () => {
  const modal = read("../../frontend/src/features/member/data/components/TransferCarryModal.tsx");
  assert.match(modal, /validateTransferAmount\(amount, source\.balance\)/);
  assert.match(modal, /reason\.trim\(\)\.length < 3/);
  assert.match(modal, /transferEstimate\(/);
  assert.match(modal, /This moves only unused carry\./);
  assert.match(modal, /Existing coverage is not changed\./);
  assert.match(modal, /Original donation and Final Event remain unchanged\./);
  assert.match(modal, /Destination Current Rule/);
  assert.match(modal, /disabled=\{busy \|\| invalid\}/);
  assert.match(modal, /createIdempotencyKey\(\)/);
  assert.doesNotMatch(modal, /getSponsorship/);
  // No implicit financial routing: destination starts unselected with a placeholder.
  assert.match(modal, /useState\(""\)/);
  assert.match(modal, /Pilih tujuan…/);
  assert.match(modal, /Pilih tujuan alokasi terlebih dahulu\./);
  assert.match(modal, /Belum ada tujuan alokasi yang valid untuk sumber ini\./);
  assert.match(modal, /destinationUnitRequirement\(/);
  assert.match(modal, /Sumber Carry/);
  assert.match(modal, /Pilih sumber secara eksplisit/);
  assert.match(modal, /sources\.length === 1/);
  assert.match(modal, /sourceSubscriptionId: source\.sourceSubscriptionId/);
  assert.match(modal, /sourceCampaignId: source\.sourceCampaignId/);
  assert.match(modal, /setDestinationId\(""\); setAmount\(next\?\.balance/);
  assert.doesNotMatch(modal, /destinations\[0\]/);
  assert.doesNotMatch(modal, /campaigns\[0\]/);
});

test("reversal UI uses danger styling, requires a reason, and renders dependency conflicts", () => {
  const modal = read("../../frontend/src/features/member/data/components/ReverseTransferModal.tsx");
  assert.match(modal, /variant="danger"/);
  assert.match(modal, /reason\.trim\(\)\.length < 3/);
  assert.match(modal, /dependencyConflictHint\(error\)/);
  assert.match(modal, /carry yang belum terpakai/);
  assert.match(modal, /data-tone="danger"/);
});

test("Program and Allocation refresh after idempotent transfer commands without response-shape branching", () => {
  const screen = read("../../frontend/src/features/member/data/components/ProgramAllocation.tsx");
  assert.match(screen, /await action\(\);/);
  assert.match(screen, /const \[sponsorshipReloaded, historyReloaded\] = await Promise\.all\(\[load\(true\), loadHistory\(true\)\]\)/);
  assert.match(screen, /if \(sponsorshipReloaded && historyReloaded\) setMessage\(success\);/);
  assert.match(screen, /Alokasi carry berhasil diproses, tetapi sebagian data gagal dimuat ulang/);
  assert.match(screen, /transferDestinationCandidates\(data\.subscriptions, ""\)/);
  assert.doesNotMatch(screen, /result\.source\.|result\.destination\./);
  assert.match(screen, /<ContributionOverview/);
  assert.match(screen, /<CarryDonorSummary summary=\{data\.carrySummary\}/);
  assert.match(screen, /<TimeBasedProgramCard/);
  assert.match(screen, /<TransferHistoryPanel/);
});

test("transfer history panel is server-paginated and reverses only backend-approved transfers", () => {
  const panel = read("../../frontend/src/features/member/data/components/TransferHistoryPanel.tsx");
  const screen = read("../../frontend/src/features/member/data/components/ProgramAllocation.tsx");
  assert.match(panel, /mode: "server"/);
  assert.match(panel, /onPageChange/);
  assert.match(panel, /row\.isReversible \?/);
  assert.match(panel, /The backend read model owns the decision/);
  assert.doesNotMatch(panel, /row\.status === "ACTIVE"/);
  assert.match(panel, /formatMoney\(row\.amount\)/);
  assert.match(panel, /row\.createdBy/);
  assert.match(panel, /sourceType === "CAMPAIGN" && row\.sourceCampaign/);
  assert.match(screen, /api\.getCarryTransfers\(memberId, historyPage, historyPageSize\)/);
  assert.match(screen, /onPageSizeChange/);
});

test("carry transfer API calls use the bounded backend endpoints", () => {
  const api = read("../../frontend/src/features/member/data/api/member-data.api.ts");
  assert.match(api, /\/carry-transfers\?/);
  assert.match(api, /subscriptions\/\$\{encodeURIComponent\(sourceSubscriptionId\)\}\/carry-transfers/);
  assert.match(api, /campaigns\/\$\{encodeURIComponent\(sourceCampaignId\)\}\/carry-transfers/);
  assert.match(api, /carry-transfers\/\$\{encodeURIComponent\(transferId\)\}\/reverse/);
  assert.match(api, /page: String\(page\)/);
  assert.match(api, /pageSize: String\(pageSize\)/);
});

test("Member detail tab is renamed and renders Program and Allocation", () => {
  const detail = read("../../frontend/src/features/member/data/components/MemberDetailScreen.tsx");
  assert.match(detail, /Program &amp; Allocation/);
  assert.match(detail, /<ProgramAllocation memberId=\{memberId\}/);
  assert.doesNotMatch(detail, /MemberSponsorship/);
});

test("identity Move and Detach reconcile Campaign economics through the wallet service", () => {
  const repository = read("../src/modules/member/data/member-data.repository.ts");
  const move = repository.slice(repository.indexOf("export function moveIdentity"), repository.indexOf("export function detachIdentity"));
  const detach = repository.slice(repository.indexOf("export function detachIdentity"), repository.indexOf("export function updateIdentityMetadata"));
  assert.match(move, /reconcileCampaignContributionsForIdentity\(tx, identityId, userId\)/);
  assert.match(detach, /reconcileCampaignContributionsForIdentity\(tx, identityId, userId\)/);
  const registration = read("../src/modules/member/registration/member-registration.repository.ts");
  assert.match(registration, /synchronizePendingCampaignContributionsForMember/);
});
