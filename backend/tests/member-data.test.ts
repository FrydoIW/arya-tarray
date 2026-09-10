import assert from "node:assert/strict";
import test from "node:test";
import { deriveAge, detachedIdentityData, mayAttachIdentity, mayDetachIdentity, mayMoveIdentity, verifiedIdentityData } from "../src/modules/member/data/member-data.domain.js";
import { identityMetadataSchema, memberDataWorkspaceQuerySchema, memberLifecycleSchema, memberProfileSchema } from "../src/modules/member/data/member-data.schema.js";

test("member workspace defaults and pagination inputs remain server-side", () => {
  assert.deepEqual(memberDataWorkspaceQuerySchema.parse({}), { search: "", status: "ACTIVE", city: "", registrationSource: "ALL", page: 1, pageSize: 25 });
  assert.equal(memberDataWorkspaceQuerySchema.safeParse({ page: 0 }).success, false);
  assert.equal(memberDataWorkspaceQuerySchema.safeParse({ pageSize: 101 }).success, false);
});

test("age derives from birth date and handles birthdays", () => {
  assert.equal(deriveAge("2000-09-06", "2026-09-05"), 25);
  assert.equal(deriveAge("2000-09-05", "2026-09-05"), 26);
  assert.equal(deriveAge(null, "2026-09-05"), null);
});

test("member profile rejects future dates, immutable fields and normalizes blanks", () => {
  assert.equal(memberProfileSchema.safeParse({ birthDate: "2999-01-01" }).success, false);
  assert.equal(memberProfileSchema.safeParse({ memberCode: "CHANGED" }).success, false);
  assert.equal(memberProfileSchema.parse({ city: "  " }).city, null);
});

test("identity transition rules reject stale states and inactive destinations", () => {
  const candidate = { memberId: null, verificationStatus: "UNVERIFIED" };
  assert.equal(mayAttachIdentity(candidate), true);
  assert.equal(mayAttachIdentity({ memberId: "a", verificationStatus: "VERIFIED" }), false);
  assert.equal(mayMoveIdentity({ memberId: "a", verificationStatus: "VERIFIED" }, "a", "b", true), true);
  assert.equal(mayMoveIdentity({ memberId: "a", verificationStatus: "VERIFIED" }, "a", "b", false), false);
  assert.equal(mayMoveIdentity({ memberId: "c", verificationStatus: "VERIFIED" }, "a", "b", true), false);
  assert.equal(mayDetachIdentity({ memberId: "a", verificationStatus: "VERIFIED" }, "a"), true);
  assert.equal(mayDetachIdentity({ memberId: "a", verificationStatus: "UNVERIFIED" }, "a"), false);
});

test("identity transition representation preserves raw evidence fields", () => {
  const evidence = { accountName: "  Budi Santoso  ", normalizedName: "BUDI SANTOSO", identityKey: "NAME|abc", sourceType: "STATEMENT" };
  const transition = verifiedIdentityData("member-b", "user", new Date("2026-09-05T00:00:00Z"));
  assert.deepEqual(Object.keys(transition).sort(), ["memberId", "updatedById", "verificationStatus", "verifiedAt", "verifiedById"].sort());
  assert.equal(evidence.accountName, "  Budi Santoso  ");
  assert.deepEqual(detachedIdentityData("user"), { memberId: null, verificationStatus: "UNVERIFIED", verifiedAt: null, verifiedById: null, updatedById: "user" });
  assert.equal(identityMetadataSchema.safeParse({ accountName: "Overwrite forbidden" }).success, false);
  assert.equal(identityMetadataSchema.safeParse({ initialName: "Alias", normalizedName: "CHANGED" }).success, false);
});

test("member lifecycle is explicit and profile updates cannot carry lifecycle or immutable-field writes", () => {
  assert.deepEqual(memberLifecycleSchema.parse({ activeFlag: false }), { activeFlag: false });
  assert.equal(memberLifecycleSchema.safeParse({ activeFlag: false, identities: [] }).success, false);
  assert.equal(memberProfileSchema.safeParse({ activeFlag: false }).success, false);
  assert.equal(memberProfileSchema.safeParse({ registrationSource: "MANUAL" }).success, false);
});
