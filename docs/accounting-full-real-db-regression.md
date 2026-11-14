# Accounting Full Real-Database Regression

Verification date: **2026-11-13 (Asia/Jakarta)**.

Scope: Full Accrual Accounting Stage 2.1–2.6 and frontend Stage 3.1–3.8.
This run distinguishes four different evidence levels: unit/contract tests,
synthetic browser tests, real DEV read-only integration, and real TEST write
integration. The TEST write level could not be executed because the isolated
`arya_tarray_test` schema and TEST-only credentials are not present.

## A. Environment verification

| Item | Result |
| --- | --- |
| MySQL server | **8.0.42** (deployment target remains 8.4) |
| Effective DEV database | **`arya_tarray_dev`** |
| Effective TEST database | **`arya_tarray_test` is absent** (`information_schema` contains only `arya_tarray_dev` among the two checked schemas) |
| PROD access | None |
| Prisma schema | `npx prisma validate` PASS |
| Physical/Prisma table set | **61 tables, exact match** to Prisma `@@map` models |
| Phase 1 COA | 2 accounts: `1110` Bank, `4110` Contribution Revenue |
| Accounting menu | `ACCOUNTING_REPORT` PAGE menu present |
| Fiscal context | FY2026 OPEN, 2026-01-01–2026-12-31; October–December periods OPEN |
| Cutover | Existing approved DEV cutover `2026-10-01`; not changed |

TEST isolation could not be established:

- `backend/.env` has no `TEST_DATABASE_URL`.
- `backend/.env.dev.local.txt` contains a `TEST_DATABASE_URL` that targets
  `/arya_tarray_dev`, not `/arya_tarray_test`; the guarded harness correctly
  rejects it. It was not used.
- The documented external Stage 2 TEST runner/change-record directory is not
  present on this machine.
- No TEST-only DML principal or explicit TEST provisioning authorization was
  available.

No TEST database was created, reset, migrated, seeded or written. No wrong
target was substituted. No PROD connection was attempted.

## B. Automated tests

| Check | Actual result |
| --- | --- |
| Backend unit/regression suite | **503/503 PASS**, 0 failed, 0 skipped |
| Backend integration suite on TEST | **NOT_TESTED** — TEST schema absent and no TEST credentials/authorization |
| Integration TypeScript | PASS |
| Frontend TypeScript | PASS |
| Backend TypeScript | PASS |
| Backend build | PASS |
| Next.js production build | PASS |
| Prisma validate | PASS; no schema change |
| Full frontend browser regression, production build, 1 worker | **180/180 PASS**, 0 failed, 0 skipped |
| Stage 3.8 targeted browser suite | **22/22 PASS** |
| Schedule remediation unit regression | 3/3 new tests PASS within the 503/503 suite |
| Schedule remediation integration scenarios | 3 scenarios added; **NOT_TESTED** with MySQL TEST |
| `git diff --check` | PASS; only existing LF/CRLF warnings |
| ESLint | NOT CONFIGURED; no PASS claimed |

The historical 174/174 integration figure is not used as current evidence. No
integration test was run against DEV, and no synthetic browser result is
reported as real database E2E.

## C. Real API verification

### DEV read-only authenticated checks

A short-lived locally signed token was created in memory for the only active
DEV user holding `ACCOUNTING_REPORT`. No token or credential is printed in this
report.

| Area | Real DEV result |
| --- | --- |
| Authentication `/api/auth/me` | 200 |
| Unauthenticated Accounting request | 401 |
| COA list | 200, total 2 |
| Fiscal years/periods | 200 |
| Legacy Accounting journals report | 200 |
| General Ledger | 200 |
| Trial Balance | 200, arithmetic balance true |
| Approval queue | 403 expected — actor has only `ACCOUNTING_REPORT`, no approval grant |
| Journal drafts | 403 expected — actor has no `ACCOUNTING_JOURNAL_MANAGE` |
| Counterparties, AP/AR documents, settlements, outstanding, aging | 200 (empty DEV scopes) |
| Accruals, scheduled reversals, schedules | 200 (empty DEV scopes) |
| Assets, categories, depreciation runs, asset reconciliation | 200 (empty DEV scopes) |
| Funds and contribution sources | 200 (empty DEV scopes) |
| Bank reconciliations | 200 (empty DEV scope) |
| Subledger reconciliation | 200, `UNVERIFIED` |
| Financial statements | 200, `UNVERIFIED`, `official: false` |
| Supporting schedules | 200, policy `PENDING_POLICY` |
| Financial integrity | 200, `UNVERIFIED` |
| Period and year closing previews | 200, both `NOT_READY` |
| Opening preparation | 200 |

Total: **35 authenticated GET contract checks** plus health and 401 checks.
There were **0 HTTP 500 responses**, **0 unexpected 401 responses**, and no API
shape failures. The two 403 responses matched the actor's actual missing grants
and were not bypassed. All DEV row counts before and after the checks were
identical.

### Real authenticated frontend smoke on DEV

The real Next.js app was run against the real backend at
`http://127.0.0.1:4100/api` with a real signed DEV session. It loaded:

`/accounting`, COA, fiscal periods, journals, approval, General Ledger,
Trial Balance, payables, receivables, counterparties, accruals, schedules,
assets, funds, reconciliation, bank reconciliation, subledger reconciliation,
closing, financial statements and existing Accounting Reports.

- **20/20 routes rendered** with their expected page headings.
- **56 real API responses, all 200** across those routes.
- 0 page errors, 0 console errors, 0 unexpected 403, 0 HTTP 500.
- Unauthenticated navigation redirected to `/login` (PASS).
- No mutation was performed in the browser; this is a read-only DEV smoke.

### TEST write workflows

**NOT_TESTED.** No isolated TEST application/database, TEST DML account or
TEST approver/poster configuration is available. The real requester → independent
approver → poster → GL → Trial Balance → subledger → reports flow was therefore
not executed against MySQL. The DEV read-only browser smoke is not a substitute
for that write workflow.

## D. Financial integrity evidence

### DEV data state

The DEV accounting operational tables are empty:

| Table group | Count |
| --- | --- |
| Accounting journals / lines | 0 / 0 |
| Journal drafts | 0 |
| Approval requests / history | 0 / 0 |
| AP/AR documents / settlements | 0 / 0 |
| Schedules / periods | 0 / 0 |
| Fixed assets | 0 |
| Funds / restrictions / releases | 0 / 0 / 0 |
| Bank reconciliations | 0 |
| Bank transactions / statement uploads | 0 / 0 |
| Accounts / fiscal years / periods | 2 / 1 / 3 |

There are no real posted journals in DEV to exercise duplicate posting,
settlement duplication, depreciation duplication, fund-release duplication or
closed-period posting effects. Those paths were not executed in DEV because DEV
writes are prohibited, and TEST is absent.

### Read-only report/integrity status

- Trial Balance: `balanced: true`, total debit `0.00`, total credit `0.00`,
  asOf `2026-12-31`, two account rows.
- Financial statements: `UNVERIFIED`, `official: false`, 4 exceptions including
  `PENDING_POLICY`, `UNMAPPED_ACTIVE_POSTING_ACCOUNT` and
  `CASH_FLOW_UNVERIFIED`. Assets, liabilities and total net assets are `0.00`;
  the equation difference is `0.00` and the equation is arithmetically
  balanced.
- Financial integrity: 17 controls, 12 PASS, 5 failing:
  `AP_SUBLEDGER_GL`, `AR_SUBLEDGER_GL`, `BANK_RECONCILIATION_REVIEW`,
  `CASHFLOW_TO_GL_CASH`, `REPORT_MAPPINGS_AND_POLICY`.
  `automaticAdjustment: false`; framework reference is null.
- Subledger reconciliation: combined `UNVERIFIED`; AP and AR `UNVERIFIED`;
  assets, accruals and funds `NOT_APPLICABLE` in this empty DEV scope.
- Period close preview: `NOT_READY` (7 PASS, 4 FAIL, 2 N/A, 2 PENDING_REVIEW).
- Year close preview: `NOT_READY` (7 PASS, 5 FAIL, 2 N/A, 3 PENDING_REVIEW);
  annual coverage reports October–December missing.
- Supporting schedules: policy `PENDING_POLICY`, report `UNVERIFIED`,
  narrative status `REQUIRES_PROFESSIONAL_REVIEW_NOT_AUTOMATICALLY_APPROVED`.

A balanced zero Trial Balance does not make the reports official. The backend
correctly returns `UNVERIFIED` / `NOT_READY`, and no balancing journal or policy
override was added.

## E. Issues

### Confirmed code defect

No new code defect was found during this run. The previously fixed schedule
CHANGE/CANCEL date issue remains fixed at unit/contract level. Its real MySQL
TEST integration scenarios are present in source but not executed.

### Environment blockers

1. **`arya_tarray_test` schema absent.** The write integration suite cannot run.
2. **No TEST-only DML credentials/authorization.** The old manual reference
   points to DEV and was rejected; the external Stage 2 runner/record is absent.
3. **No TEST requester/approver/poster setup.** Real write browser E2E cannot be
   performed.
4. **DEV user has only `ACCOUNTING_REPORT`.** Approval queue and journal-drafts
   return 403 as designed; no role grants were changed.
5. **DEV has no posted accounting transactions.** Real financial transaction
   effects cannot be exercised without writing to DEV, which is prohibited.

### Contract and capacity gaps

- Approval queue and journal draft read endpoints are permission-gated; the
  current DEV actor is report-only.
- Stage 3.3–3.6 API gaps remain as documented in
  `docs/accounting-stage3.8-financial-reports-uat.md`.
- Capacity limits remain fail-closed: cash flow 5,000 journals, 200 active
  assets at close, COA 1,000, report groups 20,000, ledger fingerprint 200,000
  lines, 240 schedule periods and other documented caps.
- MySQL 8.0.42 is verified locally; the 8.4 deployment target is not.

### Accounting policy

`PENDING_POLICY`: complete COA, framework, statement/functional/restriction/
cash-flow mappings, verified opening evidence, annual closing mappings and real
accounting evidence are not adopted. Official financial reporting remains
`NOT_READY`.

## F. Final readiness

| Area | Verdict | Evidence |
| --- | --- | --- |
| **Backend automated regression** | **PARTIAL** | Unit/contract 503/503 PASS; real MySQL TEST integration NOT_TESTED |
| **Frontend automated regression** | **PASS** | Production build; full browser 180/180 with 1 worker; Stage 3.8 22/22 |
| **Real TEST database integration** | **NOT_TESTED** | `arya_tarray_test` absent; no TEST DML credentials/authorization; no TEST schema provisioning authorized |
| **Real authenticated frontend E2E** | **PARTIAL** | Real DEV read-only: 20/20 routes, 56/56 API 200s, unauth redirect PASS; real TEST write workflow NOT_TESTED |
| **DEV read-only verification** | **PASS** | 35 authenticated GET contracts, schema/Prisma match, no 500/401, row counts unchanged |
| **Accounting policy readiness** | **PENDING_POLICY** | Backend reports UNVERIFIED/`official: false`; mappings/opening/policy evidence missing |
| **Operational deployment readiness** | **NOT_READY** | Real TEST E2E, MySQL 8.4 verification and accounting policy/evidence remain outstanding |

No source, `.env`, `.gitignore`, `AGENTS.md`, Prisma schema or database was
modified by this testing run. No Git add/commit/push/reset/clean/restore, no
PROD access, no TEST/DEV provisioning and no ZIP were performed. Temporary
backend/frontend servers used for the read-only smoke were stopped.
