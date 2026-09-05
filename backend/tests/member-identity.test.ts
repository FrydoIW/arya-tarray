import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIdentityName, observedIdentity } from "../src/modules/member/member-identity/member-identity.utils.js";
import { collectIdentityObservations } from "../src/modules/member/member-identity/member-identity.service.js";
import { memberInputSchema } from "../src/modules/member/registration/member-registration.schema.js";

const identity = (senderName: string, transactionType = "TRSF E-BANKING CR", originalAmount = "100045") =>
  observedIdentity({ senderName, transactionType, originalAmount });

test("member identities normalize case/whitespace without fuzzy name merging", () => {
  assert.equal(normalizeIdentityName("  Budi   Santoso  "), "BUDI SANTOSO");
  assert.equal(identity("  Budi   Santoso ")?.identityKey, identity("BUDI SANTOSO")?.identityKey);
  assert.notEqual(identity("BUDI S")?.identityKey, identity("BUDI SANTOSO")?.identityKey);
  assert.notEqual(identity("JOSE")?.identityKey, identity("JOSÉ")?.identityKey);
  assert.ok(identity("BUDI")!.identityKey.length <= 191);
});
test("discovery skips debit, bank credits and unusable sender evidence", () => {
  assert.equal(identity("BUDI", "TRSF E-BANKING DB", "-100045"), null);
  assert.equal(identity("BANK", "BUNGA"), null);
  assert.equal(identity("BANK", "CR KOREKSI BUNGA"), null);
  for (const name of [" ", "---", "12345", "N/A", "A".repeat(201)]) assert.equal(identity(name), null);
});
test("discovery deduplicates a batch and preserves observation bounds", () => {
  const row = { statementUploadId: "statement", senderName: "Budi", transactionType: "TRSF E-BANKING CR",
    originalAmount: "100045", memberIdentityId: null, createdAt: new Date("2026-09-05T00:00:00Z") };
  const result = collectIdentityObservations([
    { ...row, id: "1" }, { ...row, id: "2", senderName: " BUDI ", createdAt: new Date("2026-09-01T00:00:00Z"), statementUploadId: "earlier" },
    { ...row, id: "3", memberIdentityId: "already-linked" }
  ]);
  assert.equal(result.observations.length, 1);
  assert.equal(result.eligible, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.observations[0].statementId, "earlier");
  assert.deepEqual(result.observations[0].transactionIds, ["1", "2"]);
  assert.equal(result.observations[0].lastSeenAt.toISOString(), "2026-09-05T00:00:00.000Z");
});
test("member validation accepts nullable fields and rejects future or impossible dates", () => {
  const result = memberInputSchema.parse({ memberName: " Budi ", initialName: " ", email: "" });
  assert.equal(result.memberName, "Budi");
  assert.equal(result.initialName, null);
  assert.equal(result.email, null);
  for (const input of [{ memberName: " " }, { memberName: "Budi", birthDate: "2026-02-29" },
    { memberName: "Budi", birthDate: "9999-01-01" }, { memberName: "Budi", email: "invalid" }]) {
    assert.equal(memberInputSchema.safeParse(input).success, false);
  }
});
