import assert from "node:assert/strict";
import test from "node:test";
import { buildTransactionInquiryWhere, type TransactionInquiryFilter } from "../src/modules/reconciliation/transaction-inquiry/transaction-inquiry.repository.js";
import { resolveCanonicalTransactionMember, transactionHasCanonicalMember, type TransactionInquiryMember } from "../src/modules/reconciliation/transaction-inquiry/transaction-inquiry-member.domain.js";
import { transactionInquiryReportQuerySchema, transactionInquiryWorkspaceQuerySchema } from "../src/modules/reconciliation/transaction-inquiry/transaction-inquiry.schema.js";
import { buildTransactionInquiryPdf } from "../src/modules/reconciliation/transaction-inquiry/transaction-inquiry.pdf.js";

const memberA = { id: "member-a", memberCode: "MBR-A", memberName: "Member A", initialName: "A", activeFlag: true };
const memberB = { id: "member-b", memberCode: "MBR-B", memberName: "Member B", initialName: null, activeFlag: false };
const periodStart = new Date("2026-09-01T00:00:00.000Z");
const periodEnd = new Date("2026-10-01T00:00:00.000Z");

function filter(overrides: Partial<TransactionInquiryFilter> = {}): TransactionInquiryFilter {
  return { periodStart, periodEnd, search: "", status: "ALL", memberLinkStatus: "ALL", ...overrides };
}

test("canonical Member resolution uses only the identity relation and retains inactive historical Members", () => {
  assert.equal(resolveCanonicalTransactionMember(null), null);
  assert.equal(resolveCanonicalTransactionMember({ member: null }), null);
  assert.equal(transactionHasCanonicalMember({ member: null }), false);
  assert.deepEqual(resolveCanonicalTransactionMember({ member: memberB }), memberB);
  assert.equal(transactionHasCanonicalMember({ member: memberB }), true);
});

test("Move and Detach are reflected from current identity ownership without a transaction copy", () => {
  const identity: { member: TransactionInquiryMember | null } = { member: memberA };
  assert.equal(resolveCanonicalTransactionMember(identity)?.id, "member-a");
  identity.member = memberB;
  assert.equal(resolveCanonicalTransactionMember(identity)?.id, "member-b");
  assert.equal(resolveCanonicalTransactionMember({ member: null }), null);
});

test("Member filter composes server-side with period, status, bank, Final Event, and source search", () => {
  const where = buildTransactionInquiryWhere(filter({
    search: "BUDI", status: "FINALIZED", bankAccountId: "bank-a", finalEventId: "event-a", memberId: "member-a"
  }));
  assert.deepEqual(where, { AND: [
    { transactionDate: { gte: periodStart, lt: periodEnd } },
    { status: "FINALIZED" },
    { statementUpload: { is: { bankAccountId: "bank-a" } } },
    { eventCodeId: "event-a" },
    { memberIdentity: { is: { memberId: "member-a" } } },
    { OR: [
      { description: { contains: "BUDI" } }, { referenceNo: { contains: "BUDI" } },
      { senderName: { contains: "BUDI" } }, { transactionType: { contains: "BUDI" } },
      { statementUpload: { is: { fileName: { contains: "BUDI" } } } },
      { statementUpload: { is: { bankAccount: { is: { accountNo: { contains: "BUDI" } } } } } },
      { statementUpload: { is: { bankAccount: { is: { accountName: { contains: "BUDI" } } } } } }
    ] }
  ] });
});

test("Member filtering preserves both Month and Day server-side ranges", () => {
  const monthWhere = buildTransactionInquiryWhere(filter({ memberId: "member-a" }));
  const dayStart = new Date("2026-09-05T00:00:00.000Z");
  const dayEnd = new Date("2026-09-06T00:00:00.000Z");
  const dayWhere = buildTransactionInquiryWhere(filter({ periodStart: dayStart, periodEnd: dayEnd, memberId: "member-a" }));
  assert.deepEqual(monthWhere, { AND: [
    { transactionDate: { gte: periodStart, lt: periodEnd } },
    { memberIdentity: { is: { memberId: "member-a" } } }
  ] });
  assert.deepEqual(dayWhere, { AND: [
    { transactionDate: { gte: dayStart, lt: dayEnd } },
    { memberIdentity: { is: { memberId: "member-a" } } }
  ] });
});

test("LINKED and UNLINKED filters use canonical relations rather than sender-name similarity", () => {
  const linked = buildTransactionInquiryWhere(filter({ memberLinkStatus: "LINKED" }));
  const unlinked = buildTransactionInquiryWhere(filter({ memberLinkStatus: "UNLINKED" }));
  assert.deepEqual(linked, { AND: [
    { transactionDate: { gte: periodStart, lt: periodEnd } },
    { memberIdentity: { is: { member: { isNot: null } } } }
  ] });
  assert.deepEqual(unlinked, { AND: [
    { transactionDate: { gte: periodStart, lt: periodEnd } },
    { OR: [{ memberIdentityId: null }, { memberIdentity: { is: { memberId: null } } }] }
  ] });
});

test("workspace and complete-report contracts accept the same Member filters", () => {
  const shared = { periodMode: "MONTH", month: "2026-09", memberId: "11111111-1111-4111-8111-111111111111", memberLinkStatus: "LINKED" };
  const workspace = transactionInquiryWorkspaceQuerySchema.parse(shared);
  const report = transactionInquiryReportQuerySchema.parse(shared);
  assert.equal(workspace.memberId, shared.memberId);
  assert.equal(report.memberId, shared.memberId);
  assert.equal(workspace.memberLinkStatus, "LINKED");
  assert.equal(report.memberLinkStatus, "LINKED");
});

test("PDF criteria and detail rows carry the selected Member filters and canonical Member", () => {
  const content = buildTransactionInquiryPdf({
    periodLabel: "September 2026", bankAccountLabel: "All Bank Accounts", statusLabel: "All Status",
    finalEventLabel: "All Final Events", memberLabel: "MBR-A - Member A", memberLinkStatusLabel: "Linked",
    searchLabel: null, generatedBy: "Operator", generatedAt: "05 Sep 2026",
    summary: { totalTransactions: 1, totalCredit: "IDR 100.00", totalDebit: "IDR 0.00", netMovement: "IDR 100.00", incomingTransactions: 1, outgoingTransactions: 0, completeTransactions: 1 },
    classifications: [],
    transactions: [{ date: "05 Sep 2026", description: "Transfer", referenceNo: "REF-1", type: "Credit", amount: "IDR 100.00", finalEvent: "017 - Rupang", member: "MBR-A - Member A", status: "Complete" }],
    includeFinancialSummary: true, includeClassificationSummary: false, includeTransactionDetail: true
  }).toString("latin1");
  assert.match(content, /Member: MBR-A - Member A/);
  assert.match(content, /Member Link: Linked/);
  assert.match(content, /MBR-A - Member A/);
});

test("Transaction Inquiry Member integration remains valid with zero rows", () => {
  assert.equal(transactionInquiryWorkspaceQuerySchema.parse({ periodMode: "MONTH", month: "2026-09" }).memberLinkStatus, "ALL");
  assert.deepEqual(resolveCanonicalTransactionMember(undefined), null);
});
