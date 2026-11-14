# Accounting Final Audit Remediation

Verification date: **2026-11-12 (Asia/Jakarta)**.

Scope: AT-ST3-01 (schedule change after a CLOSED period), AT-ST3-02 (financial
report export labeling), regression tests, and compatibility verification. No
database schema, financial policy, Chart of Accounts, approval engine, ledger,
or Stage 3.1–3.8 module was rewritten.

## A. Fix status

| Finding | Status |
| --- | --- |
| **AT-ST3-01 — Schedule CHANGE after a CLOSED period** | **FIXED** in code and unit regression; the new database integration scenarios were added but not executed because the isolated TEST connection is not configured |
| **AT-ST3-02 — Financial report export labeling** | **FIXED** |

### AT-ST3-01 root cause

`stage23Identity` supplied the schedule `startDate` as the approval accounting
date for `SCHEDULE_SETUP`, `SCHEDULE_CHANGE` and `SCHEDULE_CANCEL`.
`submitApprovalInTransaction` then calls `requireOpenAccountingPeriod` on that
date. Therefore a CHANGE affecting only November/December was rejected when the
schedule `startDate` was in a CLOSED October. The closing-approval date resolver
also used `schedule.startDate`, so the closing-scope evidence had the same
defect.

### AT-ST3-01 correction

- **SETUP:** keeps `schedule.startDate` semantics.
- **CHANGE:** uses the earliest **unposted** schedule period recognition date.
  Every period in the requested CHANGE and its fiscal year must be OPEN.
- **CANCEL:** uses the earliest **unposted** schedule period recognition date.
  Every unposted period and its fiscal year must be OPEN. CANCEL remains a
  nonfinancial command: it creates no journal and retains the unamortized
  asset/liability.
- **TERMINATE:** unchanged; uses the explicit termination `accountingDate`.
- **SCHEDULE_PERIOD:** unchanged; uses the period recognition date.
- **Closing scope:** mirrors the same rules, so a future-only schedule change
  does not enter an earlier period's closing snapshot/digest.
- `requireOpenAccountingPeriod` remains in the common approval submission gate.
  No period is reopened, no closed-period journal is created, and no journal is
  rewritten.
- Source digest material, source version, independent-approval enforcement,
  self-approval prevention, idempotency, concurrent application protection and
  period locks are unchanged.

### CANCEL policy decision

A partially recognized schedule after a closed, already-recognized period can
be cancelled when its remaining unposted periods and fiscal year are OPEN. The
remaining GL balance is retained and the unused source capacity is released.

If any affected unposted period is CLOSED, CHANGE/CANCEL is rejected rather than
changing that closed period's plan. Operators must reopen through the existing
authorized workflow or leave the schedule unchanged. This is a conservative
policy, not a silent period override.

### AT-ST3-02 correction

- Header buttons are now `Export DRAFT Summary + TB (CSV)` and
  `Export DRAFT Summary + TB (XLSX)`.
- A persistent explanation on the Financial Statements workspace states that
  the export contains only the DRAFT summary (position totals and
  surplus/deficit) and Trial Balance lines, not the full statement views or
  supporting schedules, and is not an official financial statement.
- The backend export contract, DRAFT filename/status, exact Decimal values,
  CSV formula protection, endpoint and permission gating are unchanged.

## B. Technical changes

### Files changed

1. `backend/src/modules/accounting/schedules/schedule-approval.service.ts`
2. `backend/src/modules/accounting/schedules/schedule.service.ts`
3. `backend/src/modules/accounting/finalization/closing-approval.repository.ts`
4. `backend/tests/accounting-schedule.test.ts`
5. `backend/tests/accounting-audit-remediation.test.ts`
6. `backend/tests/integration/finalization-flow.test.ts`
7. `backend/tests/integration/schedule-flow.test.ts`
8. `frontend/src/features/accounting/reporting/FinancialReportsWorkspace.tsx`
9. `frontend/tests/browser/accounting-financial-reports.spec.ts`
10. `docs/accounting-final-audit-remediation.md` (this document)

No Prisma schema, SQL patch, `.env`, `.gitignore`, `AGENTS.md`, database or Git
history file was changed.

### Accounting date / approval semantics

| Command | Approval accounting date | Period validation |
| --- | --- | --- |
| SETUP | Schedule `startDate` | Existing common OPEN-period gate |
| CHANGE | Earliest unposted period `recognitionDate` | Every requested affected period and fiscal year must be OPEN |
| CANCEL | Earliest unposted period `recognitionDate` | Every unposted period and fiscal year must be OPEN |
| TERMINATE | Explicit command `accountingDate` | Existing chronology/source/OPEN-period checks |
| SCHEDULE_PERIOD | Period `recognitionDate` | Existing linked-period/OPEN-period checks |

The source approval material and digest still contain the command, schedule
header and period rows. Posting and application continue to validate the
current source version and digest. Closed-period posting remains rejected by
the shared ledger/period gate.

The Stage 2 audit-remediation document's historical row for
`SCHEDULE_SETUP/CHANGE/CANCEL = schedule.startDate` is superseded by this
document for CHANGE/CANCEL only. SETUP remains unchanged.

## C. Testing

### Reproduction before the fix

Three new unit regressions were written first and executed against the original
code. All three failed exactly as expected:

1. CHANGE returned October 1 instead of the first unposted date November 30.
2. Closing scope returned October 1 and counted a future-only change in an
   earlier close instead of excluding it.
3. Affected CLOSED periods were not rejected for CHANGE/CANCEL.

After the correction, all three pass.

### Test totals

| Check | Result |
| --- | --- |
| Backend unit/regression suite | **503/503 PASS**, 0 failed, 0 skipped (baseline 500 + 3 new tests) |
| Backend TypeScript (`npx tsc --noEmit`) | PASS |
| Integration test TypeScript (`npm run test:integration:typecheck`) | PASS |
| Backend production build (`npm run build`) | PASS |
| Prisma validate | PASS; schema unchanged |
| Frontend TypeScript | PASS |
| Next.js production build | PASS |
| Stage 3.8 targeted browser suite, development server | **22/22 PASS** (baseline 20 + 2 new export tests) |
| Full frontend browser regression, production build, 1 worker | **180/180 PASS**, 0 failed, 0 skipped (baseline 178 + 2 new) |
| `git diff --check` | PASS; only pre-existing LF/CRLF warnings |
| ESLint | NOT CONFIGURED; no PASS claimed and no lint dependency added |

### New regression coverage

- Unit: SETUP/CHANGE/CANCEL/TERMINATE date semantics; closing-scope date;
  future-only change excluded from an earlier close; affected CLOSED periods
  rejected; retroactive posted-period CHANGE rejected.
- Integration scenarios added (not executed in TEST):
  - CHANGE after October is posted and CLOSED while November/December remain
    OPEN; October evidence stays immutable, no duplicate amortization, the
    schedule remaining balance reconciles to GL, and closed-period changes are
    rejected.
  - CANCEL after the same October close; nonfinancial cancellation retains the
    unamortized GL balance and creates no journal.
  - CANCEL of a DRAFT schedule releases unused source capacity without a
    journal.
- Existing regression scenarios continue to cover independent approval,
  unauthorized/self approval, stale digest/version, supersession, concurrent
  period posting, termination, reversal, source-capacity and schedule
  reconciliation behavior.
- Browser: export labels and DRAFT disclosure on every statement tab; export
  backend error display; existing export endpoint/period/filename behavior;
  existing Accounting Reports PDF/XLSX export regression remains green.

### Isolated TEST database verification

`LIVE_TEST_E2E: NOT_TESTED`.

The integration runner requires all of the following before importing
application or fixture code:

- `ARYA_ENV=TEST`
- `TEST_DATABASE_URL` selecting exactly `arya_tarray_test` on loopback MySQL
- `ALLOW_TEST_INTEGRATION_WRITES=true`

These variables are not configured in the current environment. `backend/.env`
contains only the DEV database URL and was not modified. No alternative
connection was invented, no DEV/PROD writes were attempted, and no migration or
seed was run. The new integration scenarios are committed to the test source
and will run through the existing guarded TEST runner once the approved TEST
connection is supplied.

## D. Remaining risks

### Capacity limits (deliberately fail closed)

- Cash-flow drilldown: 5,000 in-scope journals; 5,001 raises HTTP 413 instead
  of returning a partial report.
- Closing: 200 active assets; above that the checklist is bounded/FAIL and
  closing is not allowed.
- COA 1,000, report account/fund groups 20,000, ledger fingerprint 200,000
  lines, annual 250 dimension groups/500 journal lines, 240 schedule periods,
  1,000 funds/designations and 5,000 designation commands remain bounded.
- Journal seal audit now scans all journals in deterministic keyset batches
  (Stage 2 remediation), with bounded retained failure evidence.

Recommended TEST-only capacity scenarios: exact 4,999/5,000/5,001 cash-flow
journals, 199/200/201 active assets at close, 999/1,000/1,001 COA rows,
19,999/20,000/20,001 report groups, and 199,999/200,000 lines for the ledger
fingerprint. A 413/truncation/FAIL result must never be represented as
VERIFIED; narrow the scope or use an approved batching design.

### Stage 3.3–3.6 API gaps

- **3.3 AP/AR:** no server-side date/due-date/sort filters; no unapplied cash or
  allocation rewrite/relink; no consolidated source audit timeline; limited
  counterparty edits.
- **3.4 Accruals/schedules:** no server list search/kind/status filters; no
  general schedule header PATCH; incomplete reversal/adjustment history
  lookups; bounded related collections.
- **3.5 Fixed assets:** raw register lacks computed values/labels; no
  standalone remaining-depreciable/pre-posting impairment/disposal quote;
  current reconciliation has no as-of/period input; valuation impairment
  reversal remains `PENDING_POLICY`.
- **3.6 Funds:** no server-side class filter; current/per-fund metrics only; no
  persisted release draft/quote/preview; no eligible-evidence discovery; no
  global restriction/designation register; conditional resolution remains
  policy-gated.

The full consolidated gap register remains in
`docs/accounting-stage3.8-financial-reports-uat.md`.

### Unverified live workflows and policy

- Live authenticated DEV/TEST API/database E2E, real role assignments, real
  approver configuration and operational evidence remain unverified.
- MySQL 8.0.42 was the previously verified local server; the MySQL 8.4
  deployment target and production packaging remain unverified.
- Accounting policy remains `PENDING_POLICY`: approved framework, complete COA,
  statement/functional/restriction/cash-flow mappings, verified opening
  balances, annual-closing mappings and real accounting evidence are not
  adopted.
- Official financial reporting remains **NOT_READY**. Backend statements are
  DRAFT/internal (`official: false`); professional review and adopted policy
  and evidence are required.

## E. Final verdict

| Readiness area | Verdict |
| --- | --- |
| **Code remediation readiness** | **COMPLETE** — AT-ST3-01 and AT-ST3-02 fixed; unit/browser regressions pass; integration scenarios added |
| **Frontend regression readiness** | **COMPLETE** — 180/180 browser tests pass with one worker against the production build |
| **Live integration readiness** | **NOT_TESTED** — no approved `TEST_DATABASE_URL`/TEST write acknowledgement is configured; no DEV/PROD access was attempted |
| **Accounting policy readiness** | **PENDING_POLICY** — framework, COA/mappings, opening evidence, annual mappings and operational evidence require authorized decisions |
| **Operational deployment readiness** | **NOT_READY** — live TEST E2E, MySQL 8.4/deployment verification and official accounting policy/evidence remain outstanding |

The code remediation is complete and the export mislabeling is removed, but the
absence of an actual TEST execution and the pending accounting policy evidence
are not treated as PASS.
