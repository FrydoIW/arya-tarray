# Full Accrual Accounting Stage 2/3 checkpoint

## Current status — Stage 2.6 PARTIAL (technical mechanisms implemented; actual policy/reporting pending)

Bank-to-GL and as-of AP/AR/asset/accrual/fund reconciliation, monthly/annual close and independent reopening, GL-based nonprofit financial statements, policy mapping/adoption, immutable reviewed report snapshots, journal-content audit seals and cross-module financial integrity are implemented. Approved patch `AT-ST26-20261108-01` added 15 fields with five ALTERs on existing tables. DEV/TEST remain 61 tables and 29 Accounting models; Prisma contract now has 800 scalar fields, with 132 enforced CHECKs. Unit/regression tests passed 432/432 and the full isolated TEST suite passed 165/165 (134 earlier scenarios plus 31 Stage 2.6 scenarios). No UI or Stage 3 was started.

Actual DEV has only COA `1110`/`4110`, no posted Accounting journals and no adopted reporting policy. Read-only runtime checks correctly return reporting/integrity UNVERIFIED and annual close NOT_READY. Real framework, complete COA/mappings, opening evidence, annual transfer accounts, bank sign-offs and authorized operational decisions remain PENDING_POLICY. No guessed policy or fictional financial data was inserted. Overall Stage 2.6 is **PARTIAL**, not officially report-ready. See [Stage 2.6 final documentation](accounting-stage2.6-final.md) for APIs, mathematics, tested scenarios, approval/backup evidence, limits and the technical/policy/operational/reporting readiness split.

## Previous status — Stage 2.5 COMPLETE

Fund register, source-backed unrestricted/restricted/conditional classification, donor terms, management designations, approved partial/full releases, reversal/source protection, explicit conditional bank review/resolution and read-only metrics/reconciliation are implemented and verified. Approved patch `AT-ST25-20261107-01` reused six existing tables; DEV/TEST remain 61 tables and 29 Accounting models, with 785 scalar fields and 128 enforced CHECKs. All 432 unit/regression and 134 integration tests passed; the latest focused fund run passed 34/34 after conditional liability/revenue metric separation. Prisma, backend/integration/frontend TypeScript, physical metadata, unchanged DEV data/environment/cutover and complete TEST cleanup passed. See [Stage 2.5 completion](accounting-stage2.5-complete.md) for APIs, source/evidence/release rules, backup/change record and explicit policy limits. No UI, Stage 2.6, production access or commit/push.

## Previous status — Stage 2.4 COMPLETE

Fixed Asset categories/register, source-backed activation, straight-line depreciation runs, prospective changes, supported impairment, disposal/write-off and GL reconciliation are implemented and verified. Approved patch `AT-ST24-20261106-01` reused existing tables; DEV/TEST still have 61 tables and 29 Accounting models. All 429 unit/regression tests and 100 isolated TEST integration tests passed. Existing data, environment/cutover and fiscal configuration are unchanged; fixtures are clean. See [Stage 2.4 completion](accounting-stage2.4-complete.md) for APIs, backup/approval evidence, accounting policy holds and explicit limits. Later Accounting modules/UI remain outside this completion.

## Previous status — Stage 2.3 COMPLETE

Accrual expenses/income, AP/AR clearing, prepaid/deferred schedules, deterministic allocation, approved period posting, schedule changes/cancellation/termination and opt-in scheduled reversal are implemented and verified. Approved patch `AT-ST23-20261105-01` reused existing tables; DEV and TEST still have 61 tables / 29 Accounting models. All 425 unit/regression tests and 78 isolated TEST integration tests passed. Physical contract, GL reconciliation, TEST cleanup and unchanged DEV/environment/cutover passed. See [Stage 2.3 completion](accounting-stage2.3-complete.md) for APIs, exact scope, policy boundaries and execution evidence. Later Accounting stages/UI remain outside this completion.

## Previous status — Stage 2.2 COMPLETE

AP/AR backend, allocations, approval/posting/reversal, bank matching, outstanding/aging and GL control reconciliation are complete. The owner approved the additive DEV+TEST patch `AT-ST22-20261105-01`; both targets remain 61 tables / 29 Accounting models. All 421 unit/regression tests and 58 isolated TEST integration tests passed. Physical schema/Prisma matching and TEST fixture cleanup passed; `.env` was unchanged. See [Stage 2.2 completion](accounting-stage2.2-complete.md) for current API, permissions, backup, test evidence and intentional scope boundaries. Later Accounting stages/UI remain outside this completion.

## Previous status — Stage 2.1 COMPLETE

The user explicitly approved record `AT-ST21-20261105-01` scope A+B+C. DEV and isolated TEST each now have 61 tables and 29 Accounting models. Approval persistence/endpoints and posting controls are implemented; cutover/fiscal periods are active; 418/418 unit tests and 37/37 real TEST integration tests passed. No technical Stage 2.1 blocker remains. Named DEV operator grants/approvers must still be configured by an authorized administrator; no user grants were widened automatically.

See [Stage 2.1 completion](accounting-stage2.1-complete.md) for the current database, endpoint, backup, permission and test evidence. Overall Stage 2/3 remains PARTIAL because later Accounting modules/UI are outside this scope.

## Historical checkpoint — superseded by approved execution

Status: **PARTIAL**. This checkpoint records implemented Phase 1 foundations and the conditions that prevent safe progression to operational posting. It is not a release or migration instruction.

## Verified baseline

- The exact local `arya_tarray_dev` connection was checked before read-only schema inspection and rollback-only integration tests. The physical database has 56 base tables. The Stage 1 schema preflight passed, including expected columns, indexes, enforced constraints, and accounts `1110`/`4110`.
- The Stage 2 approval proposal has **not** been applied. No physical database change was made for this stage. The existing 24 Accounting Prisma models remain the database contract.
- The existing reconciliation approval tables are tied to a bank statement upload or its correction proposal. They cannot record independent approvals for manual journals, AP/AR documents, settlements, or period reopening.
- No fiscal year or accounting period has been provisioned. The active local environment has no `ACCOUNTING_CUTOVER_DATE`. Do not infer a cutover date or opening balance from operational bank balances.

## Implemented foundation

- COA listing/create/update through the existing Accounting router and menu permission middleware. Used accounts retain their historical type, hierarchy and classification; there is no delete operation.
- Fiscal-year and period creation with non-overlap checks. Closing and reopening are intentionally unavailable.
- An internal balanced, exact-cent, idempotent, atomic ledger posting seam, with active account, fund, bank, counterparty and open-period checks; no public posting route.
- Internal append-only journal reversal and opening batch posting. Opening balances require balanced lines on asset, liability or net-asset accounts. Both require an authorized workflow before exposure to users.
- Read-only, paginated General Ledger and Trial Balance endpoints over posted journal lines; totals are computed over the full matching scope, not the current page.
- Existing Accounting detail UI handles non-bank journal references without assuming a bank transaction exists.
- Stage 2.1 adds reusable approval domain rules (version digest, independent approver, permission/snapshot membership, stale/rejected/cancelled blocking). These are not yet persisted or exposed because the proposed tables are absent.
- Stage 2.1 routes Phase 1 bank recognition, correction reclassification, internal ledger posting, and reversal through one posted-journal persistence gate for exact balance, source idempotency, open-period enforcement, and append-only creation. Existing Sign Approval still authorizes bank source finalization.

## Required operational change

`database/accounting-stage2-approval-proposal.mysql.sql` is a **proposal only**. The Stage 2.1 revision supplies journal draft/line plus one reusable Accounting approval request, approver snapshot, and decision history. Existing document/settlement status constraints remain unchanged. A local draft operational record is at `D:\arya-tarray-change-records\Stage-2.1-Accounting-Approval-DRAFT.md`; it is not an approval. Do not execute the SQL from application startup, tests, or Prisma tooling.

Per `AGENTS.md`, a human must approve an access-controlled operational change record outside this repository. The operator must verify the exact DEV target, make and verify a fresh backup, recheck affected-table counts and dependencies, review the SQL and an idempotent recovery sequence, then apply each DDL step under the change record. MySQL DDL can commit implicitly: if a step fails, stop, record the last completed statement, inspect the resulting schema, and use a reviewed forward fix or backup recovery. Do not blindly replay the entire file. After the physical change, update the Prisma schema to match it, then run `prisma generate` and `prisma validate`.

## Phase gates still open

1. **Phase 1:** Manual journal draft/review/approval/posting and audited period closing are absent. Provision Accounting fiscal years/periods, opening evidence and a cutover policy. The existing Phase 1 bank posting path now uses the same open-period gate as the internal ledger and persists its period ID. It remains a specialized source adapter so bank/evidence snapshots and existing recognition policy are preserved.
2. **Phase 2:** AP/AR approvals, recognition, partial settlement and aging; accrual/prepayment schedules; asset depreciation; fund release; and bank matching remain unimplemented. The existing Stage 1 tables alone do not establish authority to post them.
3. **Phase 3:** Closing checklist, subledger control reconciliation and GL-based financial statements remain unimplemented. The cash-flow method, report mapping, materiality thresholds and treatment of restrictions require adopted accounting policy.
4. **Phase 4:** Accounting navigation and operational pages have not been added. The existing `ACCOUNTING_REPORT` menu is the only active Accounting page in DEV. Granular menu permissions must be provisioned and assigned through the existing role/menu system before write routes can be used; they currently fail closed.
5. **Phase 5:** Earlier rollback-only DEV integration coverage verified the pre-Stage-2.1 core. All current integration entry points, fixture setup and cleanup now require the exact isolated local `arya_tarray_test` connection, `ARYA_ENV=TEST`, and `ALLOW_TEST_INTEGRATION_WRITES=true`. No TEST connection is configured. Tests for missing-cutover and closed-period bank rollback are prepared, and fixture cleanup verifies owned rows are absent, but these tests have not run against a physical TEST database. Pure unit tests cover the approval and shared period decisions. The revised persistence path is not yet integration-verified.

## Safety and compatibility

- The targeted integration test throws inside a serializable transaction and confirms inserted records are absent afterward when it runs. Stage 2.1 did not run any write integration test against DEV.
- No PROD connection, schema migration, seed, or reset is part of this checkpoint.
- Existing Phase 1 donation posting remains in place but now requires a matching open period for any new journal. Its Accounting report still depends on `ACCOUNTING_CUTOVER_DATE`; without that setting it cannot be considered operationally verified. The new posting seam must not be exposed as a shortcut around approval.

## Finish Stage 2.1 review

Migration remains **BLOCKED** by missing recorded approval. The external record is now approval-ready, with the exact remaining authorization fields, separate TEST provisioning scope, backup/recovery plan and the current SQL checksum. The historical controlled record directory referenced by local-environment documentation is unavailable; only the unapproved draft was found. Administrator access and conditional execution permission do not fill that gap.

The five-table proposal now also constrains draft journal types, paired decision metadata, unapplied/applied fields, required posted-journal references and audit transitions. Invalidation uses `SUPERSEDED`/`CANCELLED`; there is no inferred time expiry. The proposal contains 21 foreign keys and 43 named constraints. Static target/reference/name checks pass, which is not evidence of physical migration success.

Read-only DEV inspection still shows MySQL 8.0.42, 56 tables, zero fiscal years, zero periods, zero opening batches and zero journals. The deployment target remains MySQL 8.4. Existing documentation records DEV cutover `2026-10-01`; the underlying historical approval record is unavailable, and active `.env` has no cutover. Activation requires confirmation that this decision covers the current implementation, fiscal-year/period boundaries, and an explicitly authorized configuration update. No fiscal-year boundaries or opening values have been invented.

Sign Approval checks required cutover configuration before its decision/source updates. Finalization, Member/Campaign synchronization, Accounting posting and decision history remain in one Serializable transaction, with the whole transaction retried only for transient serialization/deadlock errors. Missing configuration or a closed period propagates an error; there is no partial-success path or external finalization side effect. Physical rollback proof is still pending isolated TEST provisioning.

Latest checks: 418/418 unit tests passed, backend and integration TypeScript checks passed, Prisma validate passed, and DEV read-only schema preflight passed. `npm run test:integration` deliberately refused execution at the TEST environment guard before Prisma import/connection because explicit TEST configuration is absent; this is a blocked integration run, not a passing integration suite. The standalone ledger rollback test was skipped for the same missing prerequisite. No database writes, DDL or configuration activation occurred during this review.

Files changed in this finish review:

- `backend/src/modules/accounting/accounting.posting.ts`
- `backend/src/modules/approval/sign-approval/sign-approval.repository.ts`
- `backend/tests/integration-guard.test.ts`
- `backend/tests/integration/test-database.ts`
- `backend/tests/integration/test-environment.ts`
- `backend/tests/integration/run-tests.ts`
- `backend/tests/integration/bootstrap-test-database.ts`
- `backend/tests/integration/dev-preflight.ts`
- `backend/tests/integration/financial-fixture.ts`
- `backend/tests/integration/accounting-flow.test.ts`
- `backend/tests/integration/accounting-foundation.test.ts`
- `backend/tests/integration/accounting-ledger-rollback.test.ts`
- `database/accounting-stage2-approval-proposal.mysql.sql`
- `docs/local-environments.md`
- `docs/accounting-stage2-3-checkpoint.md`
- External: `D:\arya-tarray-change-records\Stage-2.1-Accounting-Approval-DRAFT.md`

All prior uncommitted Stage 1 and Stage 2 work was preserved. Prisma schema, `.env`, `.gitignore`, `AGENTS.md`, UI and unrelated operational features were not edited in this finish review.
