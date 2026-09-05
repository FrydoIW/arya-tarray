import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { HttpError, SanitizedInternalError, privateErrorHandler } from "../src/lib/http.js";
import { safeErrorDiagnostic } from "../src/middleware/error.js";
import {
  isCanonicalMemberDonationCandidate,
  isOfficialDonationCandidate,
  officialDonationTransactionWhere
} from "../src/modules/member/member-donation.rules.js";
import { memberProfileFieldSchemas } from "../src/modules/member/member-profile.schema.js";
import { memberInputSchema } from "../src/modules/member/registration/member-registration.schema.js";
import { memberProfileSchema } from "../src/modules/member/data/member-data.schema.js";

test("official donation helper preserves financial and canonical Member invariants", () => {
  const base = { status: "FINALIZED", originalAmount: "100.00", eventCodeId: "event-a" };
  assert.equal(isOfficialDonationCandidate(base), true);
  assert.equal(isOfficialDonationCandidate({ ...base, status: "CHECK" }), false);
  assert.equal(isOfficialDonationCandidate({ ...base, originalAmount: "-1.00" }), false);
  assert.equal(isOfficialDonationCandidate({ ...base, eventCodeId: null }), false);
  assert.equal(isCanonicalMemberDonationCandidate({ ...base, memberId: "member-a", identityStatus: "VERIFIED" }, "member-a"), true);
  assert.equal(isCanonicalMemberDonationCandidate({ ...base, memberId: null, identityStatus: "UNVERIFIED" }, "member-a"), false);
  assert.deepEqual(officialDonationTransactionWhere(), {
    status: "FINALIZED", originalAmount: { gt: 0 }, eventCodeId: { not: null }
  });
});

test("registration and edit schemas share Member field normalization and validation", () => {
  assert.equal(memberProfileFieldSchemas.city.parse("  "), null);
  assert.equal(memberInputSchema.parse({ memberName: "  Arya  " }).memberName, "Arya");
  assert.equal(memberProfileSchema.parse({ email: "  donor@example.org  " }).email, "donor@example.org");
  assert.equal(memberInputSchema.safeParse({ memberName: "Arya", birthDate: "2999-01-01" }).success, false);
  assert.equal(memberProfileSchema.safeParse({ birthDate: "2999-01-01" }).success, false);
});

test("private Member error handling preserves expected errors and sanitizes unexpected failures", () => {
  const handler = privateErrorHandler("member-data", "Data donatur gagal diproses.");
  const forwarded: unknown[] = [];
  const next = (error?: unknown) => { forwarded.push(error); };
  const expected = new HttpError(409, "Conflict");
  handler(expected, {} as never, {} as never, next);
  assert.equal(forwarded[0], expected);

  const validation = z.string().safeParse(1);
  assert.equal(validation.success, false);
  if (validation.success) return;
  handler(validation.error, {} as never, {} as never, next);
  assert.equal(forwarded[1], validation.error);

  const databaseError = Object.assign(new Error("query args: private@example.org"), { code: "P2002" });
  handler(databaseError, {} as never, {} as never, next);
  assert.ok(forwarded[2] instanceof SanitizedInternalError);
  const diagnostic = safeErrorDiagnostic(databaseError, "member-data");
  assert.deepEqual({ context: diagnostic.context, errorType: diagnostic.errorType, code: diagnostic.code }, {
    context: "member-data", errorType: "Error", code: "P2002"
  });
  assert.equal(JSON.stringify(diagnostic).includes("private@example.org"), false);
});
