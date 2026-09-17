import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildOverlapCandidateWhere } from "../src/modules/reconciliation/statement-upload/statement-upload.repository.js";

const current = {
  id: "s-current",
  bankAccountId: "bank-a",
  periodFrom: new Date("2026-09-01T00:00:00.000Z"),
  periodTo: new Date("2026-09-30T00:00:00.000Z")
};

type OverlapWhere = {
  id: { not: string };
  bankAccountId: string;
  status: { not: string };
  periodFrom: { lte: Date };
  periodTo: { gte: Date };
};

type Candidate = { id: string; bankAccountId: string; status: string; periodFrom: Date; periodTo: Date };

const september = { periodFrom: new Date("2026-09-10T00:00:00.000Z"), periodTo: new Date("2026-09-20T00:00:00.000Z") };
const candidate = (id: string, status: string): Candidate => ({ id, bankAccountId: "bank-a", status, ...september });

function raisesOverlap(input: Candidate) {
  const where = buildOverlapCandidateWhere(current) as unknown as OverlapWhere;
  if (input.id === where.id.not) return false;
  if (input.bankAccountId !== where.bankAccountId) return false;
  if (input.status === where.status.not) return false;
  if (!(input.periodFrom <= where.periodFrom.lte)) return false;
  if (!(input.periodTo >= where.periodTo.gte)) return false;
  return true;
}

test("overlap candidate filter excludes WITHDRAWN and the selected statement", () => {
  assert.deepEqual(buildOverlapCandidateWhere(current), {
    id: { not: "s-current" },
    bankAccountId: "bank-a",
    status: { not: "WITHDRAWN" },
    periodFrom: { lte: current.periodTo },
    periodTo: { gte: current.periodFrom }
  });

  assert.equal(raisesOverlap(candidate("s-raw", "RAW")), true);
  assert.equal(raisesOverlap(candidate("s-check", "CHECK")), true);
  assert.equal(raisesOverlap(candidate("s-finalized", "FINALIZED")), true);
  assert.equal(raisesOverlap(candidate("s-withdrawn", "WITHDRAWN")), false);
  assert.deepEqual(
    [candidate("s-raw", "RAW"), candidate("s-withdrawn", "WITHDRAWN"), candidate("s-check", "CHECK")].filter(raisesOverlap).map((item) => item.id),
    ["s-raw", "s-check"]
  );
  assert.equal(raisesOverlap(candidate("s-current", "RAW")), false);
  assert.equal(raisesOverlap({ ...candidate("s-other-account", "RAW"), bankAccountId: "bank-b" }), false);
  assert.equal(raisesOverlap({
    ...candidate("s-august", "RAW"),
    periodFrom: new Date("2026-08-01T00:00:00.000Z"),
    periodTo: new Date("2026-08-31T00:00:00.000Z")
  }), false);
});

test("workspace overlap query and rendering use the canonical candidate filter", () => {
  const repository = readFileSync(new URL("../src/modules/reconciliation/statement-upload/statement-upload.repository.ts", import.meta.url), "utf8");
  const start = repository.indexOf("const overlappingStatements");
  const end = repository.indexOf("return { bankAccounts, activeEventCodes", start);
  const block = repository.slice(start, end);
  assert.match(block, /buildOverlapCandidateWhere\(\{/);
  assert.doesNotMatch(block, /status: "RAW"/);

  const service = readFileSync(new URL("../src/modules/reconciliation/statement-upload/statement-upload.service.ts", import.meta.url), "utf8");
  assert.match(service, /overlaps: records\.overlappingStatements/);

  const workspace = readFileSync(new URL("../../frontend/src/features/reconciliation/statement-upload/components/DraftWorkspace.tsx", import.meta.url), "utf8");
  assert.match(workspace, /Overlapping statement period detected/);
  assert.match(workspace, /statement\?\.overlaps\?\.length/);
});
