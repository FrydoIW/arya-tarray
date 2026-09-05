import assert from "node:assert/strict";
import test from "node:test";
import { dashboardWorkspaceQuerySchema } from "../src/modules/monitoring/dashboard/dashboard.schema.js";
import {
  isRegistrationFollowUpIdentity,
  summarizeDashboardMemberDonations,
  type DashboardDonationGroup,
  type DashboardEventCode,
  type DashboardIdentity
} from "../src/modules/monitoring/dashboard/dashboard-member.domain.js";

const eventA: DashboardEventCode = { id: "event-a", code: "017", eventName: "Rupang", category: "Dana" };
const eventB: DashboardEventCode = { id: "event-b", code: "058", eventName: "Sangha Dana", category: "Dana" };
const eventUncategorized: DashboardEventCode = { id: "event-c", code: "075", eventName: "Bhutan", category: "  " };
const memberA = { id: "member-a", memberCode: "MBR-A", memberName: "Member A", activeFlag: true };
const memberB = { id: "member-b", memberCode: "MBR-B", memberName: "Member B", activeFlag: false };

function identity(id: string, member: DashboardIdentity["member"], verificationStatus = member ? "VERIFIED" : "UNVERIFIED"): DashboardIdentity {
  return { id, member, verificationStatus };
}

function group(memberIdentityId: string | null, eventCodeId: string, amount: string, count = 1): DashboardDonationGroup {
  return { memberIdentityId, eventCodeId, _count: { _all: count }, _sum: { originalAmount: amount } };
}

test("Member Dashboard returns exact zero state", () => {
  assert.deepEqual(summarizeDashboardMemberDonations([], [], []), {
    linkedTransactionCount: 0, linkedIdentityCount: 0, linkedAmount: "0.00", contributingMemberCount: 0,
    unlinkedTransactionCount: 0, unlinkedIdentityCount: 0, unlinkedObservedAmount: "0.00",
    topMembers: [], eventGroups: []
  });
});

test("multiple VERIFIED identities aggregate once under one contributing Member without double counting", () => {
  const result = summarizeDashboardMemberDonations(
    [group("identity-a1", "event-a", "200.00", 2), group("identity-a2", "event-a", "50.00")],
    [identity("identity-a1", memberA), identity("identity-a2", memberA)], [eventA]
  );
  assert.equal(result.contributingMemberCount, 1);
  assert.equal(result.linkedIdentityCount, 2);
  assert.equal(result.linkedTransactionCount, 3);
  assert.equal(result.linkedAmount, "250.00");
  assert.deepEqual(result.topMembers[0], {
    memberId: memberA.id, memberCode: memberA.memberCode, memberName: memberA.memberName,
    activeFlag: true, transactionCount: 3, amount: "250.00"
  });
  assert.equal(result.eventGroups[0].memberCount, 1);
});

test("UNVERIFIED identity remains operational coverage and never enters canonical Member totals", () => {
  const result = summarizeDashboardMemberDonations(
    [group("identity-u", "event-a", "75.00")], [identity("identity-u", null)], [eventA]
  );
  assert.equal(result.linkedAmount, "0.00");
  assert.equal(result.contributingMemberCount, 0);
  assert.equal(result.unlinkedTransactionCount, 1);
  assert.equal(result.unlinkedIdentityCount, 1);
  assert.equal(result.unlinkedObservedAmount, "75.00");
});

test("inactive Member remains part of historical totals and Top Member ordering is deterministic", () => {
  const result = summarizeDashboardMemberDonations(
    [group("identity-b", "event-a", "500.00"), group("identity-a", "event-a", "500.00")],
    [identity("identity-a", memberA), identity("identity-b", memberB)], [eventA]
  );
  assert.equal(result.contributingMemberCount, 2);
  assert.equal(result.topMembers[0].memberCode, "MBR-A");
  assert.equal(result.topMembers[1].activeFlag, false);
});

test("Event and Category breakdown use DB category with distinct Member counts and Uncategorized", () => {
  const result = summarizeDashboardMemberDonations(
    [group("identity-a", "event-a", "100.00"), group("identity-a", "event-b", "50.00"), group("identity-b", "event-c", "25.00")],
    [identity("identity-a", memberA), identity("identity-b", memberB)], [eventA, eventB, eventUncategorized]
  );
  const dana = result.eventGroups.find(item => item.category === "Dana")!;
  const uncategorized = result.eventGroups.find(item => item.category === "Uncategorized")!;
  assert.equal(dana.memberCount, 1);
  assert.equal(dana.transactionCount, 2);
  assert.equal(dana.amount, "150.00");
  assert.equal(dana.events.length, 2);
  assert.equal(uncategorized.memberCount, 1);
  assert.equal(uncategorized.amount, "25.00");
});

test("Move and Detach change current Dashboard attribution without transaction rewrites", () => {
  const groups = [group("identity-a", "event-a", "100.00")];
  const moved = summarizeDashboardMemberDonations(groups, [identity("identity-a", memberB)], [eventA]);
  const detached = summarizeDashboardMemberDonations(groups, [identity("identity-a", null)], [eventA]);
  assert.equal(moved.topMembers[0].memberId, "member-b");
  assert.equal(detached.topMembers.length, 0);
  assert.equal(detached.unlinkedObservedAmount, "100.00");
});

test("registration follow-up accepts only detached UNVERIFIED identities", () => {
  assert.equal(isRegistrationFollowUpIdentity({ verificationStatus: "UNVERIFIED", memberId: null }), true);
  assert.equal(isRegistrationFollowUpIdentity({ verificationStatus: "VERIFIED", memberId: "member-a" }), false);
  assert.equal(isRegistrationFollowUpIdentity({ verificationStatus: "IGNORED", memberId: null }), false);
});

test("Dashboard period contract validates Month and Day modes", () => {
  assert.equal(dashboardWorkspaceQuerySchema.parse({ periodMode: "MONTH", month: "2026-09" }).periodMode, "MONTH");
  assert.equal(dashboardWorkspaceQuerySchema.parse({ periodMode: "DAY", date: "2026-09-05" }).date, "2026-09-05");
  assert.throws(() => dashboardWorkspaceQuerySchema.parse({ periodMode: "DAY" }), /Date is required/);
  assert.throws(() => dashboardWorkspaceQuerySchema.parse({ periodMode: "MONTH" }), /Month is required/);
});
