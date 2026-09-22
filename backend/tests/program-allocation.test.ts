import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { summarizeContributions, summarizeSubscriptionLedger } from "../src/modules/member/data/member-data.service.js";
import { subscriptionUpdateSchema } from "../src/modules/member/data/member-data.schema.js";
import { canOfferTransfer, centsToMoney, coverageSourceLabel, createIdempotencyKey, dependencyConflictHint, ledgerEntryKind, ledgerEntryLabel, moneyToCents, subscriptionLabel, transferDestinationCandidates, transferEstimate, validateTransferAmount } from "../../frontend/src/features/member/data/program-allocation.utils.js";

const d = (value: string) => new Prisma.Decimal(value);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

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

test("transfer destinations exclude the source, inactive programs, non-TIME_BASED programs, and programs without an active rule", () => {
  const candidates = transferDestinationCandidates([
    { subscriptionId: "source", activeFlag: true, event: { eventType: "TIME_BASED" }, timeRule: { unitAmount: "100000", durationMonths: 2 } },
    { subscriptionId: "inactive", activeFlag: false, event: { eventType: "TIME_BASED" }, timeRule: { unitAmount: "100000", durationMonths: 2 } },
    { subscriptionId: "no-rule", activeFlag: true, event: { eventType: "TIME_BASED" }, timeRule: null },
    { subscriptionId: "standard", activeFlag: true, event: { eventType: "STANDARD" }, timeRule: { unitAmount: "100000", durationMonths: 1 } },
    { subscriptionId: "campaign", activeFlag: true, event: { eventType: "CAMPAIGN" }, timeRule: { unitAmount: "100000", durationMonths: 1 } },
    { subscriptionId: "eligible", activeFlag: true, event: { eventType: "TIME_BASED" }, timeRule: { unitAmount: "500000", durationMonths: 1 } }
  ], "source");
  assert.deepEqual(candidates.map(row => row.subscriptionId), ["eligible"]);
});

test("Transfer Carry is offered only for mutable, active, positive-carry programs with a destination", () => {
  const base = { canMutate: true, memberActive: true, activeFlag: true, carry: "100000.00", destinationCount: 1 };
  assert.equal(canOfferTransfer(base), true);
  assert.equal(canOfferTransfer({ ...base, carry: "0.00" }), false);
  assert.equal(canOfferTransfer({ ...base, carry: "0" }), false);
  assert.equal(canOfferTransfer({ ...base, destinationCount: 0 }), false);
  assert.equal(canOfferTransfer({ ...base, canMutate: false }), false);
  assert.equal(canOfferTransfer({ ...base, memberActive: false }), false);
  assert.equal(canOfferTransfer({ ...base, activeFlag: false }), false);
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
  assert.match(screen, /row\.eventType === "CAMPAIGN"/);
  assert.match(screen, /row\.campaign\?\.campaignName/);
  assert.match(screen, /row\.campaign\.displayStatus/);
  assert.doesNotMatch(overview, /Transfer Carry/);
  assert.doesNotMatch(overview, /carryBalance/);
  assert.doesNotMatch(overview, /coverage/);
  assert.doesNotMatch(overview, /Time Rule/);
});

test("TIME_BASED cards separate principal, consumed, carry, current rule, and historical rate", () => {
  const card = read("../../frontend/src/features/member/data/components/TimeBasedProgramCard.tsx");
  assert.match(card, /Current rule/);
  assert.match(card, /Historical rate follows the ledger below/);
  assert.match(card, /Principal/);
  assert.match(card, /Consumed/);
  assert.match(card, /Carry tersedia/);
  assert.match(card, /canOfferTransfer\(/);
  assert.match(card, /ledgerEntryLabel\(entry\.type\)/);
  assert.match(card, /Balance history · Latest 24 entries/);
  assert.match(card, /Transfer Carry/);
});

test("TIME BASED program metadata keeps status and start date system-managed", () => {
  const screen = read("../../frontend/src/features/member/data/components/ProgramAllocation.tsx");
  const card = read("../../frontend/src/features/member/data/components/TimeBasedProgramCard.tsx");
  assert.match(screen, /<h2 id="pa-programs-title">TIME BASED<\/h2>/);
  assert.match(screen, /riwayat alokasi program donatur/);
  assert.match(screen, /statusReadOnly/);
  assert.match(screen, /formatDate\(form\.startDate\)/);
  assert.doesNotMatch(screen, /type="checkbox"/);
  assert.doesNotMatch(screen, /activeFlag: form\.activeFlag/);
  assert.doesNotMatch(screen, /Mengikuti tanggal pembayaran pertama/);
  assert.match(card, /sub\.startDate \? formatDate\(sub\.startDate\) : "—"/);
  assert.equal(subscriptionUpdateSchema.safeParse({ referenceNo: null, displayName: null, remark: null }).success, true);
  assert.equal(subscriptionUpdateSchema.safeParse({ referenceNo: null, displayName: null, remark: null, activeFlag: false }).success, false);
  assert.equal(subscriptionUpdateSchema.safeParse({ referenceNo: null, displayName: null, remark: null, startDate: "2026-09-01" }).success, false);
});

test("Transfer Carry modal validates amount, reason, destination, previews the estimate, and states the invariants", () => {
  const modal = read("../../frontend/src/features/member/data/components/TransferCarryModal.tsx");
  assert.match(modal, /validateTransferAmount\(amount, source\.carryBalance\)/);
  assert.match(modal, /reason\.trim\(\)\.length < 3/);
  assert.match(modal, /transferEstimate\(/);
  assert.match(modal, /This moves only unused carry\./);
  assert.match(modal, /Existing coverage is not changed\./);
  assert.match(modal, /Original donation and Final Event remain unchanged\./);
  assert.match(modal, /Destination Current Rule/);
  assert.match(modal, /disabled=\{busy \|\| invalid\}/);
  assert.match(modal, /createIdempotencyKey\(\)/);
  assert.doesNotMatch(modal, /getSponsorship/);
});

test("reversal UI uses danger styling, requires a reason, and renders dependency conflicts", () => {
  const modal = read("../../frontend/src/features/member/data/components/ReverseTransferModal.tsx");
  assert.match(modal, /variant="danger"/);
  assert.match(modal, /reason\.trim\(\)\.length < 3/);
  assert.match(modal, /dependencyConflictHint\(error\)/);
  assert.match(modal, /carry yang belum terpakai/);
  assert.match(modal, /data-tone="danger"/);
});

test("Program and Allocation refresh and tolerate idempotent replay responses", () => {
  const screen = read("../../frontend/src/features/member/data/components/ProgramAllocation.tsx");
  assert.match(screen, /result\.replayed \? replayedMessage : success/);
  assert.match(screen, /await Promise\.all\(\[load\(true\), loadHistory\(true\)\]\)/);
  assert.match(screen, /transferDestinationCandidates\(data\.subscriptions, sub\.subscriptionId\)/);
  assert.doesNotMatch(screen, /result\.source\.|result\.destination\./);
  assert.match(screen, /<ContributionOverview/);
  assert.match(screen, /<TimeBasedProgramCard/);
  assert.match(screen, /<TransferHistoryPanel/);
});

test("transfer history panel is server-paginated and reverses only eligible forward transfers", () => {
  const panel = read("../../frontend/src/features/member/data/components/TransferHistoryPanel.tsx");
  const screen = read("../../frontend/src/features/member/data/components/ProgramAllocation.tsx");
  assert.match(panel, /mode: "server"/);
  assert.match(panel, /onPageChange/);
  assert.match(panel, /row\.status === "ACTIVE" && !row\.reversal && !row\.reversalOf/);
  assert.match(panel, /formatMoney\(row\.amount\)/);
  assert.match(panel, /row\.createdBy/);
  assert.match(screen, /api\.getCarryTransfers\(memberId, historyPage, historyPageSize\)/);
  assert.match(screen, /onPageSizeChange/);
});

test("carry transfer API calls use the bounded backend endpoints", () => {
  const api = read("../../frontend/src/features/member/data/api/member-data.api.ts");
  assert.match(api, /\/carry-transfers\?/);
  assert.match(api, /subscriptions\/\$\{encodeURIComponent\(sourceSubscriptionId\)\}\/carry-transfers/);
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
