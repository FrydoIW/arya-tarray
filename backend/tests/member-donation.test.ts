import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCategories, categoryLabel, isOfficialMemberDonation, summarizeDonationCandidates, type DonationCandidate } from "../src/modules/member/data/member-donation.domain.js";
import { resolvePeriod } from "../src/lib/period.js";

const memberA = "member-a";
const eventA = "event-a";
function row(overrides: Partial<DonationCandidate> = {}): DonationCandidate {
  return { status: "FINALIZED", originalAmount: "100000.00", eventCodeId: eventA, memberId: memberA,
    identityStatus: "VERIFIED", transactionId: "tx-1", transactionDate: new Date("2026-09-05T00:00:00Z"), ...overrides };
}

test("official Member donation scope excludes non-final, outgoing, unclassified and unlinked rows", () => {
  assert.equal(isOfficialMemberDonation(row(), memberA), true);
  assert.equal(isOfficialMemberDonation(row({ status: "RAW" }), memberA), false);
  assert.equal(isOfficialMemberDonation(row({ status: "CHECK" }), memberA), false);
  assert.equal(isOfficialMemberDonation(row({ originalAmount: "-1.00" }), memberA), false);
  assert.equal(isOfficialMemberDonation(row({ eventCodeId: null }), memberA), false);
  assert.equal(isOfficialMemberDonation(row({ memberId: null, identityStatus: "UNVERIFIED" }), memberA), false);
  assert.equal(isOfficialMemberDonation(row({ memberId: "member-b" }), memberA), false);
});

test("lifetime aggregation spans identities and never double-counts a transaction", () => {
  const rows = [row(), row({ transactionId: "tx-2", originalAmount: "25000.50" }), row({ transactionId: "tx-2", originalAmount: "25000.50" })];
  assert.deepEqual(summarizeDonationCandidates(rows, memberA), { amount: "125000.50", transactionCount: 2 });
});

test("Month, Day and Final Event context filters selected-period totals", () => {
  const rows = [row(), row({ transactionId: "tx-2", transactionDate: new Date("2026-09-06T00:00:00Z"), eventCodeId: "event-b", originalAmount: "50000.00" }),
    row({ transactionId: "tx-3", transactionDate: new Date("2026-10-01T00:00:00Z"), originalAmount: "75000.00" })];
  const month = resolvePeriod("MONTH", "2026-09", "2026-09-01");
  const day = resolvePeriod("DAY", "2026-09", "2026-09-05");
  assert.deepEqual(summarizeDonationCandidates(rows, memberA, month), { amount: "150000.00", transactionCount: 2 });
  assert.deepEqual(summarizeDonationCandidates(rows, memberA, day), { amount: "100000.00", transactionCount: 1 });
  assert.deepEqual(summarizeDonationCandidates(rows, memberA, { ...month, eventCodeId: "event-b" }), { amount: "50000.00", transactionCount: 1 });
});

test("identity detach and move naturally change canonical Member ownership", () => {
  const contribution = row();
  assert.equal(summarizeDonationCandidates([contribution], memberA).transactionCount, 1);
  contribution.memberId = null; contribution.identityStatus = "UNVERIFIED";
  assert.equal(summarizeDonationCandidates([contribution], memberA).transactionCount, 0);
  contribution.memberId = "member-b"; contribution.identityStatus = "VERIFIED";
  assert.equal(summarizeDonationCandidates([contribution], memberA).transactionCount, 0);
  assert.equal(summarizeDonationCandidates([contribution], "member-b").transactionCount, 1);
});

test("category aggregation uses DB category only and labels blanks Uncategorized", () => {
  assert.equal(categoryLabel(null), "Uncategorized"); assert.equal(categoryLabel("  "), "Uncategorized");
  assert.deepEqual(aggregateCategories([
    { category: null, transactionCount: 1, amount: "100.00" },
    { category: "", transactionCount: 2, amount: "50.00" },
    { category: "Ritual", transactionCount: 1, amount: "200.00" }
  ]), [
    { category: "Ritual", transactionCount: 1, eventCount: 1, amount: "200.00" },
    { category: "Uncategorized", transactionCount: 3, eventCount: 2, amount: "150.00" }
  ]);
});

test("zero donation data produces exact decimal zero", () => {
  assert.deepEqual(summarizeDonationCandidates([], memberA), { amount: "0.00", transactionCount: 0 });
});
