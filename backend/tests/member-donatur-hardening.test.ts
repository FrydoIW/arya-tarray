import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { detachIdentitySchema, memberDonationQuerySchema, moveIdentitySchema } from "../src/modules/member/data/member-data.schema.js";
import { ignoreSchema } from "../src/modules/member/registration/member-registration.schema.js";

const uuidA = "11111111-1111-4111-8111-111111111111";
const uuidB = "22222222-2222-4222-8222-222222222222";

test("member ownership-changing decisions require an explicit reason", () => {
  assert.equal(moveIdentitySchema.safeParse({ destinationMemberId: uuidB }).success, false);
  assert.equal(moveIdentitySchema.safeParse({ destinationMemberId: uuidB, reason: "wrong owner" }).success, true);
  assert.equal(detachIdentitySchema.safeParse({}).success, false);
  assert.equal(detachIdentitySchema.safeParse({ reason: "not this member" }).success, true);
  assert.equal(ignoreSchema.safeParse({}).success, false);
  assert.equal(ignoreSchema.safeParse({ reason: "not a donor identity" }).success, true);
});

test("donation text search is bounded input and defaults independently from financial filters", () => {
  const parsed = memberDonationQuerySchema.parse({ periodMode: "MONTH", month: "2026-09" });
  assert.equal(parsed.search, "");
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 25);
  assert.equal(memberDonationQuerySchema.safeParse({ periodMode: "MONTH", month: "2026-09", search: "x".repeat(151) }).success, false);
});

test("Data Donatur mutation and mutation-helper routes require MEMBER_REGISTRATION in addition to MEMBER_DATA", () => {
  const source = readFileSync(new URL("../src/modules/member/data/member-data.routes.ts", import.meta.url), "utf8");
  assert.match(source, /requireMenuAccess\("MEMBER_REGISTRATION"\)/);
  for (const fragment of ["/identity-options", "/member-options", "patch(\"/:memberId\"", "/attach", "/move", "/detach"]) {
    assert.ok(source.includes(fragment), `missing protected Data Donatur route fragment: ${fragment}`);
  }
  assert.match(source, /identity-options[^\n]+requireMemberMutationAccess/);
  assert.match(source, /member-options[^\n]+requireMemberMutationAccess/);
  assert.match(source, /patch\(\"\/:memberId\/lifecycle\", requireMemberMutationAccess/);
});

test("member master keeps master-only filters and delegates analytics to donation history", () => {
  const screen = readFileSync(new URL("../../frontend/src/features/member/data/components/MemberDataScreen.tsx", import.meta.url), "utf8");
  const donationHistory = readFileSync(new URL("../../frontend/src/features/member/data/components/MemberDonationHistory.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../src/modules/member/data/member-data.service.ts", import.meta.url), "utf8");
  assert.ok(!screen.includes("PeriodPicker"));
  assert.ok(!screen.includes("Donasi Periode"));
  assert.ok(!screen.includes("Filter Final Event"));
  for (const label of ["Filter status", "Filter kota", "Filter sumber registrasi", "Muat ulang"]) assert.ok(screen.includes(label));
  assert.match(screen, /ConfirmDialog/);
  assert.match(screen, /setLifecycleAction/);
  assert.match(donationHistory, /PeriodPicker/);
  assert.match(donationHistory, /Filter Final Event/);
  assert.match(donationHistory, /Cari deskripsi \/ referensi/);
  assert.ok(!workspace.includes("selectedPeriod"));
});

test("identity ownership history schema and all canonical transition actions are present", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const dataRepo = readFileSync(new URL("../src/modules/member/data/member-data.repository.ts", import.meta.url), "utf8");
  const registrationRepo = readFileSync(new URL("../src/modules/member/registration/member-registration.repository.ts", import.meta.url), "utf8");
  assert.match(schema, /model MemberIdentityHistory/);
  assert.match(schema, /@@map\("arya_member_identity_history"\)/);
  for (const action of ["ATTACH", "MOVE", "DETACH"]) assert.ok(dataRepo.includes(`action: "${action}"`));
  for (const action of ["REGISTER", "LINK", "IGNORE"]) assert.ok(registrationRepo.includes(`action: "${action}"`));
});

test("donation row search does not drive period KPI or breakdown aggregates", () => {
  const source = readFileSync(new URL("../src/modules/member/data/member-data.repository.ts", import.meta.url), "utf8");
  assert.match(source, /const rowWhere[\s\S]+filter\.search/);
  assert.match(source, /aggregate\(\{ where: periodWhere/);
  assert.match(source, /groupBy\(\{ by: \["eventCodeId"\], where: periodWhere/);
  assert.match(source, /count\(\{ where: rowWhere/);
  assert.match(source, /findMany\(\{\n\s+where: rowWhere/);
});

test("historical event options keep inactive events that have official donation evidence", () => {
  const source = readFileSync(new URL("../src/modules/member/data/member-data.repository.ts", import.meta.url), "utf8");
  assert.ok(source.includes("OR: [{ activeFlag: true }, { transactions: { some:"));
  assert.ok(source.includes("activeFlag: true } as const") || source.includes("activeFlag: true } as const;"));
});

void uuidA;
